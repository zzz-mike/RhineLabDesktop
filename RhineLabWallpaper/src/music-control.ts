import './music-control.css';

type MusicPrefs = { music: boolean; musicVolume: number };
export function mountMusicControl(parent: HTMLElement, prefs: MusicPrefs, save: () => void, unlock: () => Promise<unknown>) {
  const root = document.createElement('div');
  root.className = 'music-control';
  root.innerHTML = `<button class="music-button" type="button" aria-label="调节背景音乐" aria-expanded="false" aria-controls="music-panel"><span aria-hidden="true">♫</span><span>音乐</span></button><div id="music-panel" class="music-panel" hidden><strong>背景音乐</strong><label>音量 <output></output><input type="range" min="0" max="100" step="1" aria-label="背景音乐音量" /></label><button type="button" class="music-mute"></button><small role="status"></small></div>`;
  parent.prepend(root);
  const button = root.querySelector<HTMLButtonElement>('.music-button')!;
  const panel = root.querySelector<HTMLElement>('.music-panel')!;
  const slider = root.querySelector<HTMLInputElement>('input')!;
  const mute = root.querySelector<HTMLButtonElement>('.music-mute')!;
  const output = root.querySelector('output')!;
  const status = root.querySelector('small')!;
  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  const sync = () => {
    slider.value = String(Math.round(prefs.musicVolume * 100));
    output.textContent = `${slider.value}%`;
    mute.textContent = prefs.music ? '静音背景音乐' : '开启背景音乐';
    mute.setAttribute('aria-pressed', String(!prefs.music));
    button.title = prefs.music && prefs.musicVolume > 0 ? `背景音乐 ${slider.value}%` : '背景音乐已静音';
    button.classList.toggle('is-muted', !prefs.music || prefs.musicVolume === 0);
  };
  const apply = () => {
    save(); sync(); status.textContent = '';
    if (prefs.music) void unlock().then(ok => { if (ok === false) status.textContent = '音乐暂未启动，请再次点击开启。'; }).catch(() => { status.textContent = '音乐暂未启动，请重试。'; });
  };
  button.addEventListener('click', () => { panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden)); });
  slider.addEventListener('input', () => { prefs.musicVolume = Number(slider.value) / 100; if (prefs.musicVolume > 0) prefs.music = true; apply(); });
  mute.addEventListener('click', () => { prefs.music = !prefs.music; if (prefs.music && prefs.musicVolume === 0) prefs.musicVolume = .5; apply(); });
  root.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); close(); button.focus(); } });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target as Node)) close(); });
  sync();
  return sync;
}
