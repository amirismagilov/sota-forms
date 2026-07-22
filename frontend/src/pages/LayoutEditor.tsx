import { HolderOutlined } from '@ant-design/icons';
import { Tag, Typography } from 'antd';
import { useMemo } from 'react';
import GridLayout, { type Layout, WidthProvider } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { Field } from '../types';

const Grid = WidthProvider(GridLayout);

const TALL = ['textarea', 'signature', 'file', 'image'];
const LAYOUT_TYPES = ['section_header', 'divider', 'info_text'];

/** Generate an initial grid layout from field order + gridSpan (migration). */
export function ensureLayout(fields: Field[], cols: number): Field[] {
  let x = 0;
  let y = 0;
  return fields.map((f) => {
    if (f.layout) {
      // clamp to current column count
      const w = Math.min(f.layout.w, cols);
      return { ...f, layout: { ...f.layout, w, x: Math.min(f.layout.x, cols - w) } };
    }
    const full = LAYOUT_TYPES.includes(f.type) || ['calculated'].includes(f.type);
    const w = full ? cols : Math.min(f.gridSpan || 1, cols);
    const h = TALL.includes(f.type) ? 2 : 1;
    if (x + w > cols) { x = 0; y += 1; }
    const layout = { x, y, w, h };
    x += w;
    if (x >= cols) { x = 0; y += 1; }
    return { ...f, layout };
  });
}

const TYPE_COLOR: Record<string, string> = {
  section_header: 'default', divider: 'default', info_text: 'default', calculated: 'blue',
};

export default function LayoutEditor({ fields, cols, onChange }: {
  fields: Field[];
  cols: number;
  onChange: (fields: Field[]) => void;
}) {
  const withLayout = useMemo(() => ensureLayout(fields, cols), [fields, cols]);

  const layout: Layout[] = withLayout.map((f) => ({
    i: f.id,
    x: f.layout!.x, y: f.layout!.y, w: f.layout!.w, h: f.layout!.h,
    minW: 1, maxW: cols, minH: 1, maxH: 4,
  }));

  function apply(next: Layout[]) {
    const byId = new Map(next.map((l) => [l.i, l]));
    const updated = withLayout.map((f) => {
      const l = byId.get(f.id);
      return l ? { ...f, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : f;
    });
    onChange(updated);
  }

  return (
    <div style={{ background: '#fafafa', borderRadius: 8, padding: 8, minHeight: 300 }}>
      <Grid
        className="layout"
        layout={layout}
        cols={cols}
        rowHeight={78}
        margin={[12, 12]}
        isBounded
        compactType="vertical"
        resizeHandles={['e', 'se', 's']}
        onDragStop={apply}
        onResizeStop={apply}
      >
        {withLayout.map((f) => (
          <div key={f.id} style={{
            border: '1px solid #d9d9d9', borderRadius: 8, background: '#fff',
            padding: 10, overflow: 'hidden', cursor: 'move', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <HolderOutlined style={{ color: '#bbb' }} />
              <Typography.Text strong ellipsis style={{ flex: 1 }}>{f.label || '(без названия)'}</Typography.Text>
              <Tag color={TYPE_COLOR[f.type] || 'geekblue'} style={{ margin: 0 }}>{f.type}</Tag>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {f.id} · ширина {f.layout!.w}/{cols}
            </Typography.Text>
          </div>
        ))}
      </Grid>
    </div>
  );
}
