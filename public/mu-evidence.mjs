export const evidenceCategories = ['Hasarlı ambalaj', 'Ürün etiketi', 'SKT bilgisi', 'Teşhir fotoğrafı'];

/** @param {File | undefined} file
 *  @param {string} category */
export async function encodeEvidence(file, category) {
  if (!file && !category) return;
  if (!file || !category) throw new Error('Geçerli bir kanıt türü ve fotoğrafı seçin.');
  if (file.size > 20 * 1024 * 1024) throw new Error('En fazla 20 MB boyutunda bir fotoğraf seçin.');
  let image;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error('Fotoğraf okunamadı. JPEG, PNG veya WebP seçin.');
  }
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Fotoğraf işlenemedi.');
    for (const maxSide of [1600, 1100, 800]) {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      if (photo && photo.length <= 4 * Math.floor(524288 / 3)) return { category, photo };
    }
    throw new Error('Fotoğraf işlenemedi.');
  } finally {
    image.close();
  }
}
