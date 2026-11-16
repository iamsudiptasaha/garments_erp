// Route transitions can produce a one-level antialiasing difference at a rounded
// edge. Compare rendered pixels with a two-level channel tolerance.
export async function sameRendering(page, left, right, edgePixels = 0) {
  if (left.equals(right)) return true;
  return page.evaluate(
    async ({ urls, edgePixels }) => {
      const read = async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [a, b] = await Promise.all(urls.map(read));
      if (a.width !== b.width || a.height !== b.height) return false;
      for (let pixel = 0; pixel < a.data.length; pixel += 4) {
        const delta = Math.max(
          Math.abs(a.data[pixel] - b.data[pixel]),
          Math.abs(a.data[pixel + 1] - b.data[pixel + 1]),
          Math.abs(a.data[pixel + 2] - b.data[pixel + 2]),
          Math.abs(a.data[pixel + 3] - b.data[pixel + 3]),
        );
        if (delta > 20 || (delta > 2 && --edgePixels < 0)) return false;
      }
      return true;
    },
    {
      urls: [left, right].map((png) => 'data:image/png;base64,' + png.toString('base64')),
      edgePixels,
    },
  );
}
