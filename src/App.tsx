import { useEffect, useState } from 'react';
import { Disc3, Layers3, LayoutGrid, Download, FolderOpen, ShieldCheck, ArrowRight,
  Server, Monitor, Laptop, Check, ChevronRight, RefreshCw, Pause, Copy, ExternalLink,
  CircleHelp, Settings2, Terminal, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { forge, type Build, type Choice, type Result, type State } from './api';

const PRODUCTS = [
  { id: 'server2022', name: 'Windows Server', subtitle: 'Servidor x64', version: '2022', icon: Server },
  { id: 'windows11', name: 'Windows 11', subtitle: 'Escritorio x64', version: 'Retail', icon: Monitor },
  { id: 'windows10', name: 'Windows 10', subtitle: 'Escritorio x64', version: '22H2', icon: Laptop },
];
const PHASES: Record<string, string> = { idle: 'Sin tareas activas', planning: 'Consultando catálogo', tools: 'Preparando herramientas',
  downloading: 'Descargando paquetes', checking: 'Comprobando edición', converting: 'Creando ISO', verifying: 'Verificando ISO',
  paused: 'Descarga pausada', complete: 'ISO lista', error: 'La tarea se detuvo' };
const BUSY = ['planning', 'tools', 'downloading', 'checking', 'converting', 'verifying'];
function bytes(n = 0) { if (n < 1024) return n + ' B'; const i = Math.min(3, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / 1024 ** i).toFixed(i > 1 ? 2 : 0) + ' ' + ['B', 'KiB', 'MiB', 'GiB'][i]; }
const errorMessage = (e: unknown) => e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e);
const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')));

export default function App() {
  const [page, setPage] = useState('catalog');
  const [product, setProduct] = useState('server2022');
  const [serverVersion, setServerVersion] = useState('server2022');
  const [builds, setBuilds] = useState<Build[]>([]), [build, setBuild] = useState('');
  const [languages, setLanguages] = useState<Choice[]>([]), [lang, setLang] = useState('');
  const [editions, setEditions] = useState<Choice[]>([]), [edition, setEdition] = useState('');
  const [directory, setDirectory] = useState(''), [updates, setUpdates] = useState(false);
  const [history, setHistory] = useState<Result[]>([]);
  const [state, setState] = useState<State>({ phase: 'idle', message: 'Sin tareas activas', logs: [], progress: 0 });
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [showLogs, setShowLogs] = useState(false), [toast, setToast] = useState('');
  const busy = BUSY.includes(state.phase);
  const selected = builds.find(b => b.uuid === build);
  const editionName = editions.find(e => e.code === edition)?.name ?? 'Edición no seleccionada';
  const isServer = product.startsWith('server');
  const productName = isServer ? `Windows Server ${product.slice(6)}` : product === 'windows11' ? 'Windows 11' : 'Windows 10';
  const ready = !!forge && !!build && !!lang && !!edition && !!directory && !loading && !error && !busy;
  const svgProps = { size: 18, 'aria-hidden': true as const };

  useEffect(() => {
    if (!forge) return;
    forge.initialize().then(initial => { setDirectory(initial.preferences.directory); setHistory(initial.history); setState(initial.state); }).catch(e => setError(errorMessage(e)));
    return forge.onState(next => { setState(next); if (next.phase === 'complete' && next.result) {
      setHistory(old => [next.result!, ...old.filter(h => h.iso !== next.result!.iso)]); }
    });
  }, []);
  useEffect(() => {
    if (!forge) return;
    let valid = true;
    setLoading(true); setError(''); setBuilds([]); setBuild(''); setLanguages([]); setLang(''); setEditions([]); setEdition('');
    forge.builds(product).then(items => { if (valid) { setBuilds(items); setBuild(items[0]?.uuid ?? '');
      if (!items.length) { setError('No hay compilaciones completas disponibles para este sistema en el catálogo.'); setLoading(false); } }
    }).catch(e => { if (valid) { setError(errorMessage(e)); setLoading(false); } });
    return () => { valid = false; };
  }, [product, revision]);
  useEffect(() => {
    if (!forge || !build) return;
    let valid = true; setLoading(true); setError(''); setLanguages([]); setLang(''); setEditions([]); setEdition('');
    forge.languages(build).then(r => { if (valid) { setLanguages(r.items);
      setLang(r.items.some(l => l.code === 'es-es') ? 'es-es' : r.items.some(l => l.code === 'en-us') ? 'en-us' : r.items[0]?.code ?? ''); }
    }).catch(e => { if (valid) { setError(errorMessage(e)); setLoading(false); } });
    return () => { valid = false; };
  }, [build]);
  useEffect(() => {
    if (!forge || !build || !lang) return;
    let valid = true; setLoading(true); setError(''); setEditions([]); setEdition('');
    forge.editions(build, lang).then(items => { if (valid) { setEditions(items);
      setEdition(items.find(e => e.code === 'SERVERSTANDARD' || e.code === 'PROFESSIONAL')?.code ?? items[0]?.code ?? '');
      setLoading(false); if (!items.length) setError('No hay ediciones completas disponibles para este idioma.'); }
    }).catch(e => { if (valid) { setError(errorMessage(e)); setLoading(false); } });
    return () => { valid = false; };
  }, [build, lang]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); }, [toast]);
  async function action(fn: () => Promise<unknown>) { try { await fn(); } catch (e) { setError(errorMessage(e)); } }
  async function chooseDirectory() { if (!forge) return; await action(async () => { const path = await forge!.chooseDirectory(); if (path) setDirectory(path); }); }
  function link(name: string) { if (forge) void action(() => forge!.openLink(name)); }
  function openFolder(folder: string) { if (forge) void action(() => forge!.openFolder(folder)); }
  async function start() { if (!forge) return; setError(''); setPage('downloads'); await action(() => forge!.start({ id: build, lang, edition, directory, updates })); }
  function selectProduct(id: string) { if (busy) return; setProduct(id === 'server2022' ? serverVersion : id); }

  function renderProgress() {
    const steps = ['Descargar', 'Crear ISO', 'Verificar', 'Listo'];
    const stage = state.phase === 'complete' ? 3 : state.phase === 'verifying' ? 2 : state.phase === 'converting' ? 1 : 0;
    return <section className="panel progress-panel" aria-labelledby="progress-title">
      <div className="section-top"><div><span className="eyebrow">ESTADO</span><h2 id="progress-title">{PHASES[state.phase] ?? state.phase}</h2></div>
        {['planning', 'tools', 'downloading', 'checking'].includes(state.phase) && <button className="secondary" onClick={() => void action(() => forge!.pause())}><Pause {...svgProps} />Pausar</button>}
        {state.phase === 'paused' && <button className="primary compact" disabled={!ready} onClick={() => void start()}><Download {...svgProps} />Reanudar</button>}
      </div>
      <ol className="steps">{steps.map((label, index) => <li key={label} className={index <= stage ? 'step current' : 'step'}>
        <span>{index < stage || state.phase === 'complete' ? <Check size={14} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
      <div className="status-copy" role="status" aria-live="polite">{state.message}</div>
      <div className="progress-track" role="progressbar" aria-label="Progreso de descarga" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={state.progress == null ? undefined : Math.round(state.progress)}>
        <div className={state.progress == null && busy ? 'progress-fill indeterminate' : 'progress-fill'} style={{ width: `${state.progress ?? 28}%` }} /></div>
      {state.phase === 'downloading' && <div className="progress-meta"><span>{bytes(state.downloadedBytes)} / {bytes(state.totalBytes)}</span><span>{Math.round(state.progress ?? 0)}%</span></div>}
      {state.file && state.phase === 'downloading' && <p className="file-detail"><span>{state.fileIndex}/{state.fileCount}</span> {state.file}</p>}
      {state.error && <div className="notice error" role="alert"><AlertTriangle {...svgProps} />{state.error}</div>}
      {state.result && <div className="result"><CheckCircle2 size={24} aria-hidden="true" /><div><strong>ISO verificada</strong><p>{state.result.iso}</p>
        <small>Imagen real: {state.result.images[0]?.version.BUILD}.{state.result.images[0]?.version.SPBUILD} · {bytes(state.result.bytes)}</small></div>
        <button className="secondary" onClick={() => openFolder(folderOf(state.result!.iso))}><FolderOpen {...svgProps} />Abrir carpeta</button></div>}
      {!!state.logs.length && <><button className="text-button logs-toggle" aria-expanded={showLogs} onClick={() => setShowLogs(!showLogs)}><Terminal {...svgProps} />{showLogs ? 'Ocultar actividad' : 'Ver actividad detallada'}</button>
        {showLogs && <div className="log-view">{state.logs.map((entry, i) => <div key={i}><time>{new Date(entry.time).toLocaleTimeString('es-AR')}</time><span>{entry.message}</span></div>)}</div>}</>}
    </section>;
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">Ir al contenido</a>
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Layers3 size={26} aria-hidden="true" /></div><div>ISO Forge</div></div>
      <span className="nav-label">NAVEGACIÓN</span>
      <nav aria-label="Navegación principal">{[
        ['catalog', LayoutGrid, 'Catálogo'], ['downloads', Download, 'Descargas'], ['library', Disc3, 'Imágenes ISO'],
      ].map(([id, Icon, label]) => { const Glyph = Icon as typeof LayoutGrid; return <button key={id as string} aria-current={page === id ? 'page' : undefined}
        className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(id as string)}><Glyph {...svgProps} />{label as string}
        {id === 'library' && history.length > 0 && <span className="count">{history.length}</span>}{id === 'downloads' && busy && <span className="dot" />}</button>; })}</nav>
      <div className="sidebar-bottom"><div className="source-card"><strong>Origen: Microsoft</strong><p>Catálogo UUP dump<br />Verificación SHA-256</p><button className="text-button" onClick={() => link('catalog')}>UUP dump <ExternalLink size={13} aria-hidden="true" /></button></div>
        <button className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')}><Settings2 {...svgProps} />Preferencias</button>
        <button className={page === 'help' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('help')}><CircleHelp {...svgProps} />Documentación</button>
        <div className="version"><span className="dot" />ISO Forge <span>v0.1.1</span></div></div>
    </aside>
    <div className="workspace"><header className="topbar"><div>ISO Forge<ChevronRight size={14} aria-hidden="true" /><strong>{({ catalog: 'Catálogo', downloads: 'Descargas', library: 'Imágenes ISO', settings: 'Preferencias', help: 'Documentación' } as Record<string, string>)[page]}</strong></div>
      <span className="top-status"><span className="dot" />{forge ? 'App de escritorio' : 'Vista previa'}</span></header>
      <main id="main" tabIndex={-1}>
        {!forge && <div className="notice">Vista previa web. La consulta del catálogo y la descarga requieren la aplicación de escritorio.</div>}
        {error && <div className="notice error" role="alert"><AlertTriangle {...svgProps} /><span>{error}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setError('')}><X size={16} /></button></div>}
        {page === 'catalog' && <>
          <div className="page-heading"><div><h1>Catálogo de Windows</h1></div><button className="secondary" disabled={busy || loading || !forge} onClick={() => setRevision(r => r + 1)}><RefreshCw {...svgProps} />Actualizar catálogo</button></div>
          <div className="product-grid" role="group" aria-label="Sistema operativo">{PRODUCTS.map(p => { const selectedProduct = p.id.startsWith('server') ? isServer : product === p.id; return <button key={p.id} disabled={busy} aria-pressed={selectedProduct}
            className={selectedProduct ? 'product-card selected' : 'product-card'} onClick={() => selectProduct(p.id)}><div className="product-icon"><p.icon size={27} aria-hidden="true" /></div>
            <span className="product-choice">{selectedProduct ? <Check size={13} aria-hidden="true" /> : ''}</span><strong>{p.name}</strong><span>{p.subtitle}</span><div className="product-footer"><span>{p.id.startsWith('server') ? serverVersion.slice(6) : p.version}</span><ArrowRight size={16} aria-hidden="true" /></div></button>; })}</div>
          <div className="configuration"><section className="panel config-panel" aria-labelledby="config-title"><div className="section-top"><div><h2 id="config-title">Configuración</h2></div><span className="badge">x64</span></div>
            <div className="form-grid">
              {isServer && <div className="field full"><label htmlFor="server-version">Versión de Windows Server</label><select id="server-version" disabled={busy} value={serverVersion} onChange={e => { setServerVersion(e.target.value); setProduct(e.target.value); }}>
                <option value="server2022">Windows Server 2022</option><option value="server2025">Windows Server 2025</option><option value="server2019">Windows Server 2019 · según disponibilidad</option></select></div>}
              <div className="field full"><label htmlFor="build">Compilación del catálogo</label><select id="build" value={build} disabled={busy || !builds.length} onChange={e => setBuild(e.target.value)}>
                {!builds.length && <option value="">{loading ? 'Buscando compilaciones…' : 'Sin compilaciones'}</option>}{builds.map(b => <option key={b.uuid} value={b.uuid}>{b.build} · {new Date(b.created * 1000).toLocaleDateString('es-AR')}</option>)}</select><small>La versión final se verifica dentro de la imagen de instalación.</small></div>
              <div className="field"><label htmlFor="lang">Idioma</label><select id="lang" value={lang} disabled={busy || !languages.length} onChange={e => setLang(e.target.value)}>
                {!languages.length && <option value="">{loading ? 'Consultando…' : 'Compilación no seleccionada'}</option>}{languages.map(l => <option key={l.code} value={l.code}>{l.code === 'es-es' ? 'Español (España)' : l.code === 'en-us' ? 'Inglés (Estados Unidos)' : l.name}</option>)}</select></div>
              <div className="field"><label htmlFor="edition">Edición</label><select id="edition" value={edition} disabled={busy || !editions.length} onChange={e => setEdition(e.target.value)}>
                {!editions.length && <option value="">{loading ? 'Consultando…' : 'Idioma no seleccionado'}</option>}{editions.map(e => <option key={e.code} value={e.code}>{e.name.replace('Windows Server ', '')}{isServer && !e.code.endsWith('CORE') ? ' · Escritorio' : ''}</option>)}</select></div>
            </div>
            <div className="update-option"><label><input type="checkbox" disabled={busy} checked={updates} onChange={e => setUpdates(e.target.checked)} /><span><strong>Integrar actualizaciones</strong><small>Más tiempo de conversión y espacio en disco.</small></span></label><span className="badge neutral">Opcional</span></div>
            <div className="destination"><div><FolderOpen {...svgProps} /><strong>Carpeta de destino</strong></div><div><code title={directory}>{directory || 'Directorio de salida no seleccionado'}</code><button className="text-button" disabled={busy || !forge} onClick={() => void chooseDirectory()}>Cambiar</button></div></div>
          </section>
          <aside className="summary panel" aria-labelledby="summary-title"><span className="eyebrow">IMAGEN SELECCIONADA</span>
            <h2 id="summary-title">{productName}</h2><p className="summary-edition">{editionName}{isServer && edition && !edition.endsWith('CORE') ? ' · Escritorio' : ''}</p>
            <dl><div><dt>Arquitectura</dt><dd>64 bits</dd></div><div><dt>Idioma</dt><dd>{lang || '—'}</dd></div><div><dt>Compilación del catálogo</dt><dd>{selected?.build ?? '—'}</dd></div><div><dt>Canal solicitado</dt><dd>Retail</dd></div></dl>
            <div className="summary-note"><ShieldCheck {...svgProps} /><span>Ediciones Evaluation excluidas. Activación con licencia compatible.</span></div>
            <button className="primary" disabled={!ready} onClick={() => void start()}><Download {...svgProps} />{loading ? 'Consultando catálogo…' : 'Descargar y crear ISO'}<ArrowRight size={16} aria-hidden="true" /></button>
            <small className="summary-footnote">La conversión avanzada puede requerir permisos de administrador.</small>
          </aside></div>
          <div className="catalog-footnote"><CircleHelp {...svgProps} /><p>{updates ? 'El conversor intentará integrar los paquetes de actualización. La imagen final muestra la versión realmente obtenida.' : 'Con actualizaciones desactivadas se crea la imagen base. Actualización posterior mediante Windows Update.'} La disponibilidad depende del catálogo.</p></div>
          {busy && renderProgress()}
        </>}
        {page === 'downloads' && <><div className="page-heading"><div><h1>Descargas</h1></div></div>
          {state.phase === 'idle' ? <section className="panel empty-state"><Download size={38} aria-hidden="true" /><h2>Sin tareas activas</h2><p>Sistema, idioma y edición disponibles en el catálogo.</p><button className="primary compact" onClick={() => setPage('catalog')}>Ir al catálogo<ArrowRight {...svgProps} /></button></section> : renderProgress()}
          {!busy && ['error', 'paused'].includes(state.phase) && <button className="secondary below" onClick={() => setPage('catalog')}>Revisar selección y reintentar<ArrowRight {...svgProps} /></button>}
        </>}
        {page === 'library' && <><div className="page-heading"><div><h1>Imágenes ISO</h1><p>Archivos generados, edición y SHA-256.</p></div><span className="badge">{history.length} {history.length === 1 ? 'imagen' : 'imágenes'}</span></div>
          {!history.length ? <section className="panel empty-state"><Disc3 size={42} aria-hidden="true" /><h2>Sin imágenes registradas</h2><p>Las conversiones verificadas se registran automáticamente.</p><button className="primary compact" onClick={() => setPage('catalog')}>Abrir catálogo<ArrowRight {...svgProps} /></button></section> : <div className="library">{history.map(result => <article className="panel library-card" key={result.iso}><Disc3 size={32} aria-hidden="true" /><div><h2>{result.images[0]?.name ?? result.edition}</h2><p>{result.lang} · {bytes(result.bytes)} · {result.images[0]?.version.BUILD}.{result.images[0]?.version.SPBUILD}</p><code>{result.sha256}</code><small>{result.iso}</small></div><div className="library-actions"><button className="secondary" onClick={() => openFolder(folderOf(result.iso))}><FolderOpen {...svgProps} />Abrir carpeta</button><button className="text-button" onClick={() => void action(async () => { await forge!.copy(result.sha256); setToast('SHA-256 copiado'); })}><Copy {...svgProps} />Copiar SHA-256</button></div></article>)}</div>}
        </>}
        {page === 'settings' && <><div className="page-heading"><div><h1>Preferencias</h1><p>Almacenamiento local y herramientas.</p></div></div><section className="panel prose"><h2>Destino predeterminado</h2><p>Espacio necesario para paquetes UUP, medio temporal e ISO final: al menos 30–40 GiB libres. Algunas versiones requieren más espacio.</p><code className="path">{directory || 'Directorio no seleccionado'}</code><button className="secondary" disabled={busy || !forge} onClick={() => void chooseDirectory()}><FolderOpen {...svgProps} />Elegir carpeta</button><h2>Herramientas de conversión</h2><p>Se descargan al usarlas por primera vez. El paquete tiene una versión fijada y se valida por SHA-256 antes de ejecutarse. La conversión usa wimlib y herramientas de Microsoft mediante UUP converter.</p><h2>Activación</h2><p>La activación requiere una licencia compatible con la edición instalada. No se incluyen claves ni activadores.</p></section></>}
        {page === 'help' && <><div className="page-heading"><div><h1>Documentación</h1><p>Descarga, conversión y requisitos.</p></div></div><section className="panel prose"><h2>1. Selección de edición</h2><p>El catálogo UUP dump reúne paquetes que sirven los servidores de Microsoft. ISO Forge solicita el canal Retail, filtra Evaluation y vuelve a verificar la edición dentro de la imagen.</p><h2>2. Descarga y verificación</h2><p>Cada archivo se comprueba con el SHA-256 del catálogo. La descarga se reanuda al iniciar la misma selección y destino después de una pausa o un fallo de conexión. Los enlaces se renuevan al reintentar.</p><h2>3. Conversión a ISO</h2><p>La conversión avanzada requiere autorización de administrador en Windows. El proceso puede durar varios minutos. Se comprueban la imagen resultante, su edición y las entradas BIOS/UEFI. La verificación no incluye arranque ni instalación en una VM.</p><h2>Versiones disponibles</h2><p>Windows 10, Windows 11 y versiones de Windows Server, según disponibilidad. No hay un catálogo universal para todas las versiones históricas, ediciones OEM o imágenes de licencias por volumen. Si faltan paquetes o un SHA-256, la app informa el problema.</p><h2>Compilación del catálogo e imagen base</h2><p>La fecha y compilación del catálogo pueden incluir actualizaciones separadas. Con esa opción desactivada, la ISO contiene la base. El registro de imágenes ISO muestra la versión leída de la imagen final.</p><div className="help-links"><button className="secondary" onClick={() => link('microsoft')}>Descargas de Microsoft<ExternalLink {...svgProps} /></button><button className="secondary" onClick={() => link('catalog')}>UUP dump<ExternalLink {...svgProps} /></button></div></section></>}
        <footer><span>ISO Forge</span><span>Fuentes Microsoft · Integridad SHA-256</span></footer>
      </main>
    </div>
    {toast && <div className="toast" role="status"><Check {...svgProps} />{toast}</div>}
  </div>;
}
