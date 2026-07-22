import { Button, Space } from 'antd';
import { useEffect, useRef } from 'react';

interface Props {
  value?: string; // data URL
  onChange: (dataUrl: string | undefined) => void;
}

/** Minimal canvas signature capture (ФР field type `signature`). */
export default function SignaturePad({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = value;
    }
  }, []); // eslint-disable-line

  function pos(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e: React.PointerEvent) {
    drawing.current = true;
    last.current = pos(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL('image/png'));
  }
  function clear() {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
    onChange(undefined);
  }

  return (
    <Space direction="vertical">
      <canvas
        ref={canvasRef}
        width={360}
        height={140}
        style={{ border: '1px solid #d9d9d9', borderRadius: 6, touchAction: 'none', cursor: 'crosshair' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <Button size="small" onClick={clear}>Очистить</Button>
    </Space>
  );
}
