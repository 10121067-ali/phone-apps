// Install-to-home-screen popup. Browsers only allow installing after a tap,
// so this pops up a one-tap sheet as soon as the page opens.
(() => {
  const name = (document.currentScript && document.currentScript.dataset.name) || document.title;
  const icon = (document.currentScript && document.currentScript.dataset.icon) || 'icon-192.png';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let evt = null, box = null;

  const style = document.createElement('style');
  style.textContent = `
.pi-wrap{position:fixed;inset:0;z-index:100;display:flex;align-items:flex-end;justify-content:center;background:#0008;font-family:system-ui,"Segoe UI",Tahoma,sans-serif}
.pi-sheet{width:100%;max-width:460px;background:#111827;color:#f1f5f9;border-radius:20px 20px 0 0;padding:18px 18px calc(18px + env(safe-area-inset-bottom));direction:rtl;text-align:center;animation:pi-up .25s ease-out}
@keyframes pi-up{from{transform:translateY(100%)}to{transform:none}}
.pi-sheet img{width:72px;height:72px;border-radius:16px;margin-bottom:6px}
.pi-sheet h3{margin:4px 0 6px;font-size:19px}
.pi-sheet p,.pi-sheet ol{color:#cbd5e1;font-size:14.5px;line-height:1.8;margin:0 0 12px}
.pi-sheet ol{text-align:right;padding-right:20px}
.pi-sheet button{display:block;width:100%;border:0;border-radius:14px;padding:15px;font-size:17px;font-weight:800;margin-top:8px;font-family:inherit;cursor:pointer}
.pi-yes{background:#22c55e;color:#052e16}.pi-no{background:transparent;color:#94a3b8;font-weight:500!important;font-size:15px!important}`;
  document.head.appendChild(style);

  function close() { if (box) { box.remove(); box = null; } }

  function open() {
    if (standalone) return;
    close();
    let body;
    if (evt) body = `<p>نزّلها عالشاشة متل أي تطبيق — بتفتح بكبسة وبلا متصفح.</p><button class="pi-yes" data-a="go">📲 نزّل التطبيق</button>`;
    else if (ios) body = `<ol><li>كبّس زر المشاركة <b>⬆️</b> تحت بـ Safari</li><li>اختار <b>Add to Home Screen</b></li><li>كبّس <b>Add</b></li></ol>`;
    else body = `<ol><li>كبّس القائمة <b>⋮</b> فوق بـ Chrome</li><li>اختار <b>Install app</b> أو <b>Add to Home screen</b></li></ol>`;
    box = document.createElement('div');
    box.className = 'pi-wrap';
    box.innerHTML = `<div class="pi-sheet"><img src="${icon}" alt=""><h3>${name}</h3>${body}<button class="pi-no" data-a="no">مش هلّق</button></div>`;
    box.onclick = async e => {
      const a = e.target.dataset && e.target.dataset.a;
      if (e.target === box || a === 'no') { sessionStorage.setItem('pi:no', '1'); close(); }
      if (a === 'go' && evt) {
        const ev = evt; evt = null; close();
        ev.prompt();
        await ev.userChoice.catch(() => null);
      }
    };
    document.body.appendChild(box);
  }

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    evt = e;
    if (!standalone && !sessionStorage.getItem('pi:no')) setTimeout(open, 500);
  });
  window.addEventListener('appinstalled', () => { close(); document.querySelectorAll('[data-install]').forEach(b => b.remove()); });
  if (!standalone && ios && !localStorage.getItem('pi:ios')) { localStorage.setItem('pi:ios', '1'); setTimeout(open, 1200); }

  window.pwaInstall = { open, standalone };
})();
