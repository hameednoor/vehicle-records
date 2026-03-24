/**
 * Compress an image file to a smaller JPEG before uploading.
 * Resizes to max dimension and uses JPEG compression.
 * Returns a new File object (or the original if already small).
 */
export function compressImage(file, maxSize = 1500, quality = 0.7) {
  return new Promise((resolve) => {
    if (!file.type?.startsWith('image/')) {
      resolve(file);
      return;
    }

    if (file.size < 500 * 1024) {
      resolve(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let w = img.width;
      let h = img.height;

      if (w > maxSize || h > maxSize) {
        if (w > h) {
          h = Math.round(h * (maxSize / w));
          w = maxSize;
        } else {
          w = Math.round(w * (maxSize / h));
          h = maxSize;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (blob && blob.size < file.size) {
            const compressed = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
              type: 'image/jpeg',
              lastModified: file.lastModified,
            });
            console.log(`[Compress] ${file.name}: ${Math.round(file.size / 1024)} KB → ${Math.round(compressed.size / 1024)} KB`);
            resolve(compressed);
          } else {
            resolve(file);
          }
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };

    img.src = url;
  });
}
