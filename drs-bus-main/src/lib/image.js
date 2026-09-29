// Reading an image the user picked into a base64 data: URL for the JSON
// API. The server stores images in the database (not on disk — Railway's
// filesystem is wiped on redeploy) and refuses anything over 5 MB, so the
// same limit is checked here first to fail fast with a clear message.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_ACCEPT = ACCEPTED_TYPES.join(",");

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file. Try another image."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file doesn't look like a valid image."));
    img.src = src;
  });
}

/**
 * Validates type/size and returns a data: URL.
 *
 * `shrink: true` is for payment screenshots: a phone screenshot is often a
 * 2–4 MB PNG, and a multi-seat order stores one copy per seat, so large
 * ones are re-encoded as a JPEG no wider/taller than 1600 px — still easily
 * readable by staff. Leave it off for the payment QR itself: re-encoding a
 * QR code as JPEG can blur the modules and make it unscannable.
 */
export async function readImageFile(file, { shrink = false } = {}) {
  if (!file) return null;
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP or GIF image.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`);
  }
  const dataUrl = await readAsDataUrl(file);
  if (!shrink || file.type === "image/gif") return dataUrl;

  const img = await loadImage(dataUrl);
  const MAX_SIDE = 1600;
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size <= 800 * 1024) return dataUrl; // already small

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; // transparent PNG areas would turn black in JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const shrunk = canvas.toDataURL("image/jpeg", 0.85);
  return shrunk.length < dataUrl.length ? shrunk : dataUrl;
}

export function formatPeso(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  return `₱${Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
