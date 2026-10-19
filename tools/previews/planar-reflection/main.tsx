// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Check, ChevronRight, HelpCircle, MoreHorizontal, RotateCcw, Search, Scan } from 'lucide-react';
import { Select } from '@/components/Select';
import { NumField } from '@/components/NumField';
import { IconButton } from '@/components/IconButton';
import { BoolControl, VecControl } from '@/panels/inspector/controls';
import { TipLayer } from '@/components/TipLayer';
import scene from '../../../examples/device-quality/assets/scenes/main.esscene';

declare const HAS_REFERENCE_FRAME: boolean;
const floor = scene.entities.find(e => e.name === 'Floor')!;
const transform = floor.components.find(c => c.type === 'Transform')!.data;
const defaults = {
  enabled: true, axis: 'y', clipOffset: 0.02, layers: 'all',
  quality: 'project', scale: '0.5', maxSize: 1024,
  update: 'every-frame', rate: 30, preview: false,
};
type Draft = typeof defaults;

function App() {
  const [data, setData] = useState<Draft>({ ...defaults });
  const write = <K extends keyof Draft>(key: K, value: Draft[K]) => setData(old => ({ ...old, [key]: value }));
  const row = (key: keyof Draft, label: string, control: React.ReactNode, hint?: string) =>
    <div className={`prop${data[key] !== defaults[key] ? ' modified' : ''}`} data-tip={hint}>
      <span className="prop-label">{label}</span><div className="prop-value">{control}</div>
      {data[key] !== defaults[key] && <IconButton size="xs" className="prop-reset show" title="重置为默认值" onClick={() => write(key, defaults[key])}><RotateCcw size={12}/></IconButton>}
    </div>;
  const choice = (key: keyof Draft, label: string, options: [string, string][], hint?: string) =>
    row(key, label, <Select value={String(data[key])} options={options.map(([value, label]) => ({ value, label }))} onChange={value => write(key, value as never)} ariaLabel={label}/>, hint);
  const group = (label: string) => <div className="group">{label}</div>;
  return <main><TipLayer/>
    <header><h1>平面反射</h1><span>RM-044 · 水体系统前置 · 交互设计稿</span></header>
    <p className="intro">基于 Device Quality 实际场景的 Floor，使用项目当前主题、属性行与控件。此页只修改内存草稿。</p>
    <div className="layout">
      <section className="design-panel">
        <div className="tab">Details<MoreHorizontal size={14}/></div>
        <div className="design-search"><Search size={13}/><input placeholder="搜索属性" aria-label="搜索属性" readOnly/></div>
        <div className="insp"><div className="ent-head"><div className="ent-row1">
          <span className="ent-chk on"><Check size={12}/></span><span className="ent-ic"><Box size={18}/></span>
          <div className="ent-main"><input className="ent-name" value={floor.name} readOnly/><span className="ent-sub">Type Entity · ID {floor.id}</span></div>
        </div></div><div className="insp-body">
          <details className="comp transform"><summary className="comp-head"><ChevronRight size={12}/><Box size={14}/><span className="comp-name">Transform</span></summary>
            <div className="comp-fields"><div className="prop"><span className="prop-label">位置</span><div className="prop-value"><VecControl value={['x', 'y', 'z'].map(axis => transform.position?.[axis] ?? 0)} onChange={() => {}}/></div></div></div>
          </details>
          <section className={`comp open${data.enabled ? '' : ' disabled-reflection'}`}>
            <div className="comp-head"><span className="comp-arrow"><ChevronRight size={12}/></span>
              <button className={`comp-chk${data.enabled ? ' on' : ''}`} role="checkbox" aria-label="启用平面反射" aria-checked={data.enabled} onClick={() => write('enabled', !data.enabled)}><Check size={10}/></button>
              <Scan size={14}/><span className="comp-name">Planar Reflection</span>
              <IconButton size="xs" title="根据当前相机和实体平面捕获动态反射。反射平面由 Transform 定位；捕获不包含接收面自身，也不递归生成其他反射。"><HelpCircle size={12}/></IconButton><MoreHorizontal size={14}/>
            </div>
            <fieldset className="comp-fields reflection-fields" disabled={!data.enabled} inert={!data.enabled}>
              {group('捕获')}
              <div className="prop"><span className="prop-label">源相机</span><div className="prop-value"><span className="read-value">当前渲染相机</span></div></div>
              {choice('axis', '平面法线', [['x', '本地 X 轴'], ['y', '本地 Y 轴'], ['z', '本地 Z 轴']], '跟随实体的世界变换。Y 轴适合水平地面，Z 轴适合竖直镜面；支持任意旋转。')}
              {row('clipOffset', '裁剪偏移', <NumField value={data.clipOffset} min={0} step={0.005} onCommit={v => write('clipOffset', v)}/>, '沿反射平面法线偏移裁剪边界，单位与场景一致。仅捕获源相机所在一侧的几何，避免水下物体穿入反射。')}
              {choice('layers', '反射层', [['all', '全部层'], ['world', '场景物件'], ['actors', '角色']], '正式实现复用项目层掩码选择器，此处为选择交互示意。接收面始终排除，屏幕 UI 不进入捕获。')}
              {group('质量')}
              {choice('quality', '质量来源', [['project', '跟随项目画质'], ['custom', '自定义']], '复用当前画质档位。可为指定反射面单独调整，不改写项目全局设置。')}
              {data.quality === 'project'
                ? <p className="field-note">由当前画质档位配置反射分辨率与更新策略。未连接运行时，此处不显示实际值。</p>
                : <>
                  {choice('scale', '分辨率比例', [['0.25', '¼'], ['0.5', '½'], ['1', '1×']], '相对于源相机的实际渲染尺寸，保持宽高比。')}
                  {row('maxSize', '最长边上限', <NumField value={data.maxSize} min={64} max={4096} step={64} onCommit={v => write('maxSize', v)}/>)}
                  {choice('update', '更新方式', [['every-frame', '每帧'], ['rate', '指定频率'], ['manual', '按需']], '默认每帧更新。指定频率与按需更新属于作者主动选择，不限制主场景帧率。')}
                  {data.update === 'rate' && row('rate', '每秒更新次数', <NumField value={data.rate} min={1} max={120} onCommit={v => write('rate', v)}/>) }
                </>}
              <details className="diagnostics"><summary>诊断与预览</summary>
                {row('preview', '显示反射平面', <BoolControl value={data.preview} onChange={v => write('preview', v)}/>)}
                <p className="field-note">等待运行时数据。这里将显示捕获尺寸、更新状态、额外绘制次数与资源占用；未分配或不可见时显示原因。</p>
              </details>
            </fieldset>
          </section>
        </div></div>
      </section>
      <aside>
        <div className="reference-head"><h2>实际项目参考</h2><span>Device Quality · 3D</span></div>
        {HAS_REFERENCE_FRAME && <figure><img src="./reference-3d.png" alt="Device Quality 实际项目的渲染画面，尚未启用平面反射"/><figcaption>已有项目的实际渲染画面；尚未实现平面反射效果。</figcaption></figure>}
        <h3>先打通通用反射，再接水体</h3><p>反射捕获、资源生命周期、材质采样和质量配置统一实现。水面、镜子、光滑地面都可复用，接收材质保留自己的颜色、法线和粗糙度。</p>
        <h3>沿用现在的 Details</h3><p>标准组件头、紧凑属性行、弱分组、修改与重置提示。诊断默认折叠，不另造一套设置窗口。</p>
        <h3>多相机与性能</h3><p>捕获跟随当前渲染相机，避免固定到某个游戏相机后编辑器视角失配。先支持一个活动反射面，并明确报告超出预算；默认每帧更新，质量策略仅影响反射捕获。</p>
        <h3>实现与验收顺序</h3><ol><li>镜像相机、斜裁剪、绕序与自反射排除。</li><li>统一离屏捕获和材质采样，处理设备恢复与多相机。</li><li>WebGL2 / WebGPU 动态物体像素验收，再接项目画质。</li><li>随后做水体材质、波纹与岸线效果。</li></ol>
        <p className="note">这是待确认的界面设计，不是运行验收。正式组件、Inspector 和项目场景尚未修改。</p>
      </aside>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
