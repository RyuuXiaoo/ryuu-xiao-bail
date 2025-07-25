"use strict"
Object.defineProperty(exports, "__esModule", { value: true })
const boom_1 = require("@hapi/boom")
const crypto_1 = require("crypto")
const path_1 = require("path")
const os_1 = require("os")
const fs_1 = require("fs")
const WABinary_1 = require("../WABinary")
const generics_1 = require("./generics")
const messages_media_1 = require("./messages-media")
const parseCatalogNode = (node) => {
const catalogNode = WABinary_1.getBinaryNodeChild(node, 'product_catalog')
const products = WABinary_1.getBinaryNodeChildren(catalogNode, 'product').map(parseProductNode)
const paging = WABinary_1.getBinaryNodeChild(catalogNode, 'paging')
return {
products,
nextPageCursor: paging
? WABinary_1.getBinaryNodeChildString(paging, 'after')
: undefined
}
}
const parseCollectionsNode = (node) => {
const collectionsNode = WABinary_1.getBinaryNodeChild(node, 'collections')
const collections = WABinary_1.getBinaryNodeChildren(collectionsNode, 'collection').map(collectionNode => {
const id = WABinary_1.getBinaryNodeChildString(collectionNode, 'id')
const name = WABinary_1.getBinaryNodeChildString(collectionNode, 'name')
const products = WABinary_1.getBinaryNodeChildren(collectionNode, 'product').map(parseProductNode)
return {
id,
name,
products,
status: parseStatusInfo(collectionNode)
}
})
return {
collections
}
}
const parseOrderDetailsNode = (node) => {
const orderNode = WABinary_1.getBinaryNodeChild(node, 'order')
const products = WABinary_1.getBinaryNodeChildren(orderNode, 'product').map(productNode => {
const imageNode = WABinary_1.getBinaryNodeChild(productNode, 'image')
return {
id: WABinary_1.getBinaryNodeChildString(productNode, 'id'),
name: WABinary_1.getBinaryNodeChildString(productNode, 'name'),
imageUrl: WABinary_1.getBinaryNodeChildString(imageNode, 'url'),
price: +WABinary_1.getBinaryNodeChildString(productNode, 'price'),
currency: WABinary_1.getBinaryNodeChildString(productNode, 'currency'),
quantity: +WABinary_1.getBinaryNodeChildString(productNode, 'quantity')
}
})
const priceNode = WABinary_1.getBinaryNodeChild(orderNode, 'price')
const orderDetails = {
price: {
total: +WABinary_1.getBinaryNodeChildString(priceNode, 'total'),
currency: WABinary_1.getBinaryNodeChildString(priceNode, 'currency'),
},
products
}
return orderDetails
}
const toProductNode = (productId, product) => {
const attrs = {}
const content = []
if (typeof productId !== 'undefined') {
content.push({
tag: 'id',
attrs: {},
content: Buffer.from(productId)
})
}
if (typeof product.name !== 'undefined') {
content.push({
tag: 'name',
attrs: {},
content: Buffer.from(product.name)
})
}
if (typeof product.description !== 'undefined') {
content.push({
tag: 'description',
attrs: {},
content: Buffer.from(product.description)
})
}
if (typeof product.retailerId !== 'undefined') {
content.push({
tag: 'retailer_id',
attrs: {},
content: Buffer.from(product.retailerId)
})
}
if (product.images.length) {
content.push({
tag: 'media',
attrs: {},
content: product.images.map(img => {
if (!('url' in img)) {
throw new boom_1.Boom('Expected img for product to already be uploaded', { statusCode: 400 })
}
return {
tag: 'image',
attrs: {},
content: [
{
tag: 'url',
attrs: {},
content: Buffer.from(img.url.toString())
}
]
}
})
})
}
if (typeof product.price !== 'undefined') {
content.push({
tag: 'price',
attrs: {},
content: Buffer.from(product.price.toString())
})
}
if (typeof product.currency !== 'undefined') {
content.push({
tag: 'currency',
attrs: {},
content: Buffer.from(product.currency)
})
}
if ('originCountryCode' in product) {
if (typeof product.originCountryCode === 'undefined') {
attrs['compliance_category'] = 'COUNTRY_ORIGIN_EXEMPT'
}
else {
content.push({
tag: 'compliance_info',
attrs: {},
content: [
{
tag: 'country_code_origin',
attrs: {},
content: Buffer.from(product.originCountryCode)
}
]
})
}
}
if (typeof product.isHidden !== 'undefined') {
attrs['is_hidden'] = product.isHidden.toString()
}
const node = {
tag: 'product',
attrs,
content
}
return node
}
const parseProductNode = (productNode) => {
const isHidden = productNode.attrs.is_hidden === 'true'
const id = WABinary_1.getBinaryNodeChildString(productNode, 'id')
const mediaNode = WABinary_1.getBinaryNodeChild(productNode, 'media')
const statusInfoNode = WABinary_1.getBinaryNodeChild(productNode, 'status_info')
const product = {
id,
imageUrls: parseImageUrls(mediaNode),
reviewStatus: {
whatsapp: WABinary_1.getBinaryNodeChildString(statusInfoNode, 'status'),
},
availability: 'in stock',
name: WABinary_1.getBinaryNodeChildString(productNode, 'name'),
retailerId: WABinary_1.getBinaryNodeChildString(productNode, 'retailer_id'),
url: WABinary_1.getBinaryNodeChildString(productNode, 'url'),
description: WABinary_1.getBinaryNodeChildString(productNode, 'description'),
price: +WABinary_1.getBinaryNodeChildString(productNode, 'price'),
currency: WABinary_1.getBinaryNodeChildString(productNode, 'currency'),
isHidden,
}
return product
}
/**
* Uploads images not already uploaded to WA's servers
*/
async function uploadingNecessaryImagesOfProduct(product, waUploadToServer, timeoutMs = 30000) {
product = {
...product,
images: product.images ? await uploadingNecessaryImages(product.images, waUploadToServer, timeoutMs) : product.images
}
return product
}
/**
* Uploads images not already uploaded to WA's servers
*/
const uploadingNecessaryImages = async (images, waUploadToServer, timeoutMs = 30000) => {
const results = await Promise.all(images.map(async (img) => {
if ('url' in img) {
const url = img.url.toString()
if (url.includes('.whatsapp.net')) {
return { url }
}
}
const { stream } = await messages_media_1.getStream(img)
const hasher = crypto_1.createHash('sha256')
const filePath = path_1.join(os_1.tmpdir(), 'img' + generics_1.generateMessageID())
const encFileWriteStream = fs_1.createWriteStream(filePath)
for await (const block of stream) {
hasher.update(block)
encFileWriteStream.write(block)
}
const sha = hasher.digest('base64')
const { directPath } = await waUploadToServer(filePath, {
mediaType: 'product-catalog-image',
fileEncSha256B64: sha,
timeoutMs
})
await fs_1.promises
.unlink(filePath)
.catch(err => console.log('Error deleting temp file ', err))
return { url: messages_media_1.getUrlFromDirectPath(directPath) }
}))
return results
}
const parseImageUrls = (mediaNode) => {
const imgNode = WABinary_1.getBinaryNodeChild(mediaNode, 'image')
return {
requested: WABinary_1.getBinaryNodeChildString(imgNode, 'request_image_url'),
original: WABinary_1.getBinaryNodeChildString(imgNode, 'original_image_url')
}
}
const parseStatusInfo = (mediaNode) => {
const node = WABinary_1.getBinaryNodeChild(mediaNode, 'status_info')
return {
status: WABinary_1.getBinaryNodeChildString(node, 'status'),
canAppeal: WABinary_1.getBinaryNodeChildString(node, 'can_appeal') === 'true',
}
}
module.exports = {
parseCatalogNode, 
parseCollectionsNode, 
parseOrderDetailsNode, 
toProductNode, 
parseProductNode, 
uploadingNecessaryImagesOfProduct, 
uploadingNecessaryImages
}