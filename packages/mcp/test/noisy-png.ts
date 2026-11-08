const encoder = new TextEncoder()

const chunk = (type: string, data: Uint8Array) => {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  bytes.set(encoder.encode(type), 4)
  bytes.set(data, 8)
  view.setUint32(8 + data.length, Bun.hash.crc32(bytes.subarray(4, 8 + data.length)))
  return bytes
}

/** `Bun.deflateSync` emits raw deflate; PNG needs the zlib header and Adler-32 trailer. */
const zlib = (data: Uint8Array<ArrayBuffer>) => {
  const deflated = Bun.deflateSync(data)
  const stream = new Uint8Array(deflated.length + 6)
  stream.set([0x78, 0x01])
  stream.set(deflated, 2)
  new DataView(stream.buffer).setUint32(deflated.length + 2, Bun.hash.adler32(data))
  return stream
}

/** An RGB PNG of random pixels: the worst case for JPEG previews, which cannot compress it. */
export const noisyPng = (width: number, height: number): Uint8Array => {
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2], 8)
  const stride = width * 3 + 1
  const pixels = new Uint8Array(stride * height)
  for (let row = 0; row < height; row += 1) {
    crypto.getRandomValues(pixels.subarray(row * stride + 1, (row + 1) * stride))
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib(pixels)),
    chunk("IEND", new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}
