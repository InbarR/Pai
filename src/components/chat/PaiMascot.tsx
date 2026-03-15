import { useState, useEffect, useRef } from 'react';

export default function PaiMascot({ size = 80 }: { size?: number }) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let animFrame: number;
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0;

    const onMove = (e: MouseEvent) => {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const max = size * 0.07;
      targetX = dist > 0 ? (dx / dist) * Math.min(max, dist * 0.018) : 0;
      targetY = dist > 0 ? (dy / dist) * Math.min(max, dist * 0.018) : 0;
    };

    const animate = () => {
      currentX += (targetX - currentX) * 0.1;
      currentY += (targetY - currentY) * 0.1;
      setOffset({ x: currentX, y: currentY });
      animFrame = requestAnimationFrame(animate);
    };

    window.addEventListener('mousemove', onMove);
    animFrame = requestAnimationFrame(animate);
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(animFrame); };
  }, [size]);

  const tiltDeg = offset.x * 1.2;
  const eyeX = offset.x * 2;
  const eyeY = offset.y * 2;

  return (
    <div ref={ref} className="pai-mascot" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) rotate(${tiltDeg}deg)` }}>

        {/* Ambient glow */}
        <circle cx="50" cy="50" r="42" fill="url(#glow)" opacity="0.2" />

        {/* Shadow */}
        <ellipse cx="50" cy="92" rx="20" ry="3" fill="#6366f1" opacity="0.12" />

        {/* === THE π SHAPE === */}

        {/* π crossbar — this IS the face/head */}
        <rect x="18" y="24" width="64" height="26" rx="13" fill="url(#headGrad)" stroke="#6366f1" strokeWidth="1.2" />

        {/* Left leg of π */}
        <path d="M 34 50 L 32 82" stroke="url(#legGrad)" strokeWidth="8" strokeLinecap="round" />

        {/* Right leg of π — classic curved */}
        <path d="M 64 50 C 64 62, 68 74, 70 82" stroke="url(#legGrad)" strokeWidth="8" strokeLinecap="round" fill="none" />

        {/* Feet — little shoes */}
        <ellipse cx="31" cy="84" rx="6" ry="3" fill="#4f46e5" />
        <ellipse cx="71" cy="84" rx="6" ry="3" fill="#4f46e5" />

        {/* === FACE on the crossbar === */}

        {/* Left eye — clipped so nothing escapes the socket */}
        <clipPath id="leftEyeClip"><ellipse cx="38" cy="36" rx="6.5" ry="6" /></clipPath>
        <ellipse cx="38" cy="36" rx="6.5" ry="6" fill="#0e0e2a" />
        <g clipPath="url(#leftEyeClip)">
          <circle cx={38 + eyeX} cy={36 + eyeY} r="3.5" fill="#a5b4fc" />
          <circle cx={39 + eyeX * 0.5} cy={35 + eyeY * 0.5} r="1.2" fill="white" opacity="0.4" />
        </g>
        {/* Left blink */}
        <ellipse cx="38" cy="36" rx="6.5" ry="6" fill="url(#headGrad)">
          <animate attributeName="ry" values="0;0;6;6;0;0;6" dur="4s" repeatCount="indefinite"
            keyTimes="0;0.01;0.04;0.96;0.98;0.99;1" />
          <animate attributeName="opacity" values="1;1;0;0;1;1;0" dur="4s" repeatCount="indefinite"
            keyTimes="0;0.01;0.04;0.96;0.98;0.99;1" />
        </ellipse>

        {/* Right eye — clipped */}
        <clipPath id="rightEyeClip"><ellipse cx="62" cy="36" rx="6.5" ry="6" /></clipPath>
        <ellipse cx="62" cy="36" rx="6.5" ry="6" fill="#0e0e2a" />
        <g clipPath="url(#rightEyeClip)">
          <circle cx={62 + eyeX} cy={36 + eyeY} r="3.5" fill="#a5b4fc" />
          <circle cx={63 + eyeX * 0.5} cy={35 + eyeY * 0.5} r="1.2" fill="white" opacity="0.4" />
        </g>
        {/* Right blink */}
        <ellipse cx="62" cy="36" rx="6.5" ry="6" fill="url(#headGrad)">
          <animate attributeName="ry" values="0;0;6;6;0;0;6" dur="4s" repeatCount="indefinite"
            keyTimes="0;0.01;0.04;0.96;0.98;0.99;1" />
          <animate attributeName="opacity" values="1;1;0;0;1;1;0" dur="4s" repeatCount="indefinite"
            keyTimes="0;0.01;0.04;0.96;0.98;0.99;1" />
        </ellipse>

        {/* Smile */}
        <path d={`M 44 ${44 + eyeY * 0.12} Q 50 ${49 + eyeY * 0.12} 56 ${44 + eyeY * 0.12}`}
          stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.7" />

        {/* Cheeks */}
        <circle cx={30 + eyeX * 0.1} cy={40 + eyeY * 0.1} r="3" fill="#818cf8" opacity="0.12" />
        <circle cx={70 + eyeX * 0.1} cy={40 + eyeY * 0.1} r="3" fill="#818cf8" opacity="0.12" />

        {/* === ASSISTANT ACCESSORIES === */}

        {/* Headset band */}
        <path d="M 22 30 C 22 14, 78 14, 78 30" stroke="#4f46e5" strokeWidth="2.5" fill="none" strokeLinecap="round" />

        {/* Left earpiece */}
        <rect x="17" y="28" width="6" height="9" rx="3" fill="#4f46e5" />

        {/* Right earpiece */}
        <rect x="77" y="28" width="6" height="9" rx="3" fill="#4f46e5" />

        {/* Mic from left ear */}
        <path d={`M 20 37 C 17 42, 24 46, 30 ${45 + eyeY * 0.08}`}
          stroke="#4f46e5" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <circle cx={30 + offset.x * 0.15} cy={45 + eyeY * 0.08} r="2.5" fill="#6366f1">
          <animate attributeName="fill" values="#6366f1;#a5b4fc;#6366f1" dur="2.5s" repeatCount="indefinite" />
        </circle>

        {/* Little arms waving from the legs */}
        <path d={`M 30 58 C 22 55, 16 60, 18 ${65 + offset.y * 0.2}`}
          stroke="#5558e6" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <circle cx={18 + offset.x * 0.15} cy={65 + offset.y * 0.2} r="2.8" fill="#6366f1" />

        <path d={`M 68 58 C 76 55, 82 60, 80 ${65 + offset.y * 0.2}`}
          stroke="#5558e6" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        <circle cx={80 + offset.x * 0.15} cy={65 + offset.y * 0.2} r="2.8" fill="#6366f1" />

        <defs>
          <linearGradient id="headGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d2d7a" />
            <stop offset="100%" stopColor="#1e1e5a" />
          </linearGradient>
          <linearGradient id="legGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
          <radialGradient id="glow">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}
