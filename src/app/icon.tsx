import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0F172A',
        color: '#F8FAFC',
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: -1,
        lineHeight: 1,
        paddingBottom: 2,
      }}
    >
      C
    </div>,
    { ...size },
  );
}
