import { useState } from 'react';

// Decorative artwork (alt="" - the asset name is already announced by its heading). Hidden if the file is missing.
export function AssetImage({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailedSrc(src)}
      style={{ display: 'block', maxWidth: '100%', maxHeight: '320px', objectFit: 'contain', margin: '0.75rem 0' }}
    />
  );
}
