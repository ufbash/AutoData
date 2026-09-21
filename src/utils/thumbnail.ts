// Downscales a remote image to a small blob URL. The vehicle photos are stored full size
// (2576x1879 - about 19 MB decoded each), and Supabase image transformation is not enabled on
// this project (transform URLs return 403), so showing 12 of them in 80px tiles kept ~230 MB of
// decoded bitmaps alive and made scrolling crawl. Decoding at the target size keeps only the
// small bitmap. The caller owns the returned object URL and must revoke it.
export async function makeThumbnail(url: string, width = 320): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image request failed: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob(), { resizeWidth: width, resizeQuality: 'medium' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.75));
    if (!blob) throw new Error('Could not encode thumbnail');
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}
