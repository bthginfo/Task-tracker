import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Overlay({title, children, onClose, drawer = false, className = '', active = true}: {title:string; children:ReactNode; onClose:()=>void; drawer?:boolean; className?:string; active?:boolean}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    if(!active)return;
    const previous = document.activeElement as HTMLElement | null;
    const element = panel.current;
    const timer = setTimeout(() => { const target = element?.querySelector<HTMLElement>('[data-autofocus]') || element?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]'); target?.focus(); }, 40);
    function trap(event:KeyboardEvent) {
      if (event.key === 'Escape') { event.stopPropagation(); onCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') || []).filter(item => item.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || !element?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !element?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', trap);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', trap); previous?.focus(); };
  }, [active]);
  return <div className={`overlay ${drawer ? 'drawer-overlay' : ''}`} inert={!active} aria-hidden={!active||undefined} onMouseDown={event => { if (active&&event.target === event.currentTarget) onClose(); }}><div ref={panel} role="dialog" aria-modal={active?true:undefined} aria-label={title} className={`${drawer ? 'drawer' : 'dialog'} ${className}`}><header className="dialog-heading"><h2>{title}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Schließen"><X size={19}/></button></header>{children}</div></div>;
}

export function Spinner({label = 'Wird geladen'}:{label?:string}) { return <span className="spinner" role="status" aria-label={label}/>; }

export function Toggle({checked, onChange, label, disabled = false}:{checked:boolean; onChange:(value:boolean)=>void; label:string; disabled?:boolean}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`switch ${checked ? 'on' : ''}`}><span/></button>;
}
