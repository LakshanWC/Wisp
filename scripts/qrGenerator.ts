import QRCode, { QRCodeRenderersOptions } from "qrcode"

export type UrlShareObject = {
  url: string
}

export type QRResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string }

const options: QRCodeRenderersOptions = {
  errorCorrectionLevel: "H",
  type: "image/png",
  margin: 1,
  color: {
    dark: "rgb(255, 255, 255)",
    light: "rgb(0, 0, 0)"
  }
}

const QR_BYTE_LIMIT = 1000

// generate and show qr — never throws, always resolves
export async function generateQRCode(urlToShare: UrlShareObject): Promise<QRResult> {
  if (!urlToShare?.url) {
    return { ok: false, error: "No URL provided." }
  }

  const dataToEncode = checkDataSize(urlToShare)
  return generateQR({ url: dataToEncode })
}

// check if the url fits; trim if not
function checkDataSize(data: UrlShareObject): string {
  try {
    const byteLength = new TextEncoder().encode(data.url).length
    if (byteLength > QR_BYTE_LIMIT) {
      return trimUrlData(data)
    }
    return data.url
  } catch (error) {
    // console.error("checkDataSize failed, falling back to trim:", error)
    return trimUrlData(data)
  }
}

function trimUrlData(data: UrlShareObject): string {
  try {
    const url = new URL(data.url)
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch (error) {
    console.error("trimUrlData: invalid URL, using raw string:", error)
    return data.url
  }
}

async function generateQR(data: UrlShareObject): Promise<QRResult> {
  try {
    const dataUrl = await QRCode.toDataURL(data.url, options)
    return { ok: true, dataUrl }
  } catch (error) {
    try {
      const dataUrl = await QRCode.toDataURL(data.url, { errorCorrectionLevel: "L" })
      return { ok: true, dataUrl }
    } catch (fallbackError) {
      const message = fallbackError instanceof Error ? fallbackError.message : "Unknown QR generation error"
      return { ok: false, error: `Failed to generate QR code: ${message}` }
    }
  }
}