// Route transitions can produce a one-level antialiasing difference at a rounded
// edge. Compare rendered pixels with a two-level channel tolerance.
export async function sameRendering(page, left, right) {
  if (left.equals(right)) return true;
  return page.evaluate(
    async (urls) => {
      const read = async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [a, b] = await Promise.all(urls.map(read));
      return (
        a.width === b.width &&
        a.height === b.height &&
        a.data.every((value, i) => Math.abs(value - b.data[i]) <= 2)
      );
    },
    [left, right].map((png) => 'data:image/png;base64,' + png.toString('base64')),
  );
}
