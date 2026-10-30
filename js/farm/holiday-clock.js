import { createHolidayClock } from './halloween-core.js';
const clocks = new WeakMap();

export function holidayClock(game) {
    if (clocks.has(game)) return clocks.get(game);
    let request;
    const clock = createHolidayClock({
        async readServerTime() {
            const url = new URL('../../farmgame.html', import.meta.url);
            // Avoid an older CDN/browser cached Date; no farm/database writes.
            url.searchParams.set('event-clock', String(Date.now()));
            request = new AbortController();
            const timeout = setTimeout(() => request?.abort(), 5000);
            try {
                const response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: request.signal });
                return response.ok ? Date.parse(response.headers.get('Date') || '') : NaN;
            } finally { clearTimeout(timeout); request = null; }
        },
    });
    clocks.set(game, clock);
    game.events.once('destroy', () => { request?.abort(); clock.dispose(); clocks.delete(game); });
    return clock;
}
