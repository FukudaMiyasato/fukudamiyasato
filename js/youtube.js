/* ============================================================
   youtube.js — links de YouTube en el portafolio
   ------------------------------------------------------------
   Un video de YouTube no es un archivo: no se puede pintar en WebGL
   (es un iframe de otro dominio). La portada lo muestra con el
   reproductor de YouTube de fondo (sin controles, en silencio y en
   bucle) y le pone encima el damero/pixelado en CSS.
   Lo usan la portada (js/home.js) y el panel (miniaturas).
   ============================================================ */

/** id del video (11 caracteres) o '' si no es un link de YouTube.
    Acepta watch?v=, youtu.be/, shorts/, embed/, live/ y music.youtube.com. */
export function youtubeId(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return ''; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = '';
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/) || [])[1] || '';
  }
  return /^[\w-]{11}$/.test(id) ? id : '';
}

/** Reproductor de fondo: sin controles, en silencio, en bucle. enablejsapi deja
    mandarle órdenes (play, pausa, sonido) con postMessage. */
export const youtubeEmbed = (id) => `https://www.youtube-nocookie.com/embed/${id}?${new URLSearchParams({
  autoplay: '1', mute: '1', loop: '1', playlist: id, controls: '0', disablekb: '1',
  playsinline: '1', modestbranding: '1', rel: '0', iv_load_policy: '3', fs: '0', enablejsapi: '1',
})}`;

export const youtubeThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

/** Orden al reproductor ('playVideo', 'pauseVideo', 'mute', 'unMute', 'seekTo'…). */
export function youtubeCommand(iframe, func, args = []) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}
