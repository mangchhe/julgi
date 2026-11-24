// 앱에 들어 있는 배경 그림들. 그림 파일 없이 SVG로 그려서 용량이 없고 어느 크기에서도 깨끗하다.
// 어두운 쪽이 많고 밝은 데가 조금 있는 그림이어야 글자가 묻히지 않는다: 어두운 테마에서는 밝은 쪽만 바탕에 더해진다

const svg = (body: string) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">${body}</svg>`);

/** id는 저장하지 않는다. 고르면 그림 자체가 배경 사진으로 들어간다 */
export const BACKDROPS: { id: string; url: string }[] = [
  {
    id: "ridge", // 밤의 능선: 남색에서 보라로 내려가는 하늘, 겹친 산, 옅은 달
    url: svg(
      `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1030"/><stop offset="0.6" stop-color="#3a2a66"/><stop offset="1" stop-color="#7a4a78"/></linearGradient><radialGradient id="m" cx="0.72" cy="0.3" r="0.28"><stop offset="0" stop-color="#ffe9c4" stop-opacity="0.55"/><stop offset="1" stop-color="#ffe9c4" stop-opacity="0"/></radialGradient></defs>` +
        `<rect width="1600" height="1000" fill="url(#s)"/><rect width="1600" height="1000" fill="url(#m)"/><circle cx="1150" cy="300" r="62" fill="#fff1d6" opacity="0.8"/>` +
        `<path d="M0 640 260 500 480 610 760 450 1010 600 1290 470 1600 620V1000H0Z" fill="#2a2152" opacity="0.9"/><path d="M0 760 330 620 620 760 900 640 1220 780 1600 660V1000H0Z" fill="#1a1538"/><path d="M0 880 420 780 800 900 1180 800 1600 890V1000H0Z" fill="#0d0b20"/>`,
    ),
  },
  {
    id: "aurora", // 오로라: 어두운 바탕 위에 크게 번진 청록, 보라, 파랑
    url: svg(
      `<defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="120"/></filter></defs>` +
        `<rect width="1600" height="1000" fill="#070a14"/><g filter="url(#b)"><ellipse cx="380" cy="300" rx="420" ry="220" fill="#16c7a8" opacity="0.55"/><ellipse cx="1050" cy="420" rx="480" ry="240" fill="#5b5bf0" opacity="0.5"/><ellipse cx="1350" cy="780" rx="380" ry="200" fill="#b04bd6" opacity="0.45"/><ellipse cx="300" cy="850" rx="360" ry="180" fill="#1f6fe0" opacity="0.4"/></g>`,
    ),
  },
  {
    id: "grid", // 모눈: 옅은 점 격자와 한쪽 구석의 부드러운 빛
    url: svg(
      `<defs><pattern id="d" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="1.6" fill="#8fb4ff" opacity="0.55"/></pattern><radialGradient id="g" cx="0.85" cy="0.1" r="0.8"><stop offset="0" stop-color="#3f6fd8" stop-opacity="0.6"/><stop offset="1" stop-color="#3f6fd8" stop-opacity="0"/></radialGradient></defs>` +
        `<rect width="1600" height="1000" fill="#080b12"/><rect width="1600" height="1000" fill="url(#g)"/><rect width="1600" height="1000" fill="url(#d)"/>`,
    ),
  },
];
