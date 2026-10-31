export const GRAVITY = 360;
// Leave the lower quarter of the visible farm available for pulling the string,
// away from browser controls and Android navigation gestures.
export function archeryControlLayout(view) {
    const x = view.left + view.width / 2;
    const bottom = view.top + view.height;
    const fullPull = 1050 / 9;
    const y = Math.min(view.top + view.height * .76, bottom - fullPull - 80 / (view.zoom || 1));
    return { bow: { x, y }, button: { x: x - 125, y: y + 10 }, help: { x, y: y + 66 } };
}
export function launchVelocity(origin, pull) {
    const dx=origin.x-pull.x, dy=origin.y-pull.y, length=Math.hypot(dx,dy);
    if (length<12) return null;
    const speed=Math.min(1050,length*9);
    return {x:dx/length*speed,y:dy/length*speed};
}
export function arrowPoint(origin,velocity,seconds) {
    return {x:origin.x+velocity.x*seconds,y:origin.y+velocity.y*seconds+GRAVITY*seconds*seconds/2};
}
// Swept test in ellipse space avoids arrows passing through between frames.
export function arrowHits(start,end,bounds) {
    const rx=bounds.width*.36,ry=bounds.height*.36;
    if(rx<=0||ry<=0)return false;
    const cx=bounds.centerX,cy=bounds.centerY;
    const ax=(start.x-cx)/rx,ay=(start.y-cy)/ry;
    const dx=(end.x-start.x)/rx,dy=(end.y-start.y)/ry;
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    return (ax+dx*t)**2+(ay+dy*t)**2<=1;
}
