const key = value => encodeURIComponent(String(value)).replaceAll('.', '%2E');
function wire(value) {
    if (value === null || value === undefined) return { kind: 'null' };
    if (typeof value?.toMillis === 'function') return { kind: 'timestamp', value: value.toMillis() };
    if (Array.isArray(value)) return value.length ? { kind: 'array', value: Object.fromEntries(value.map((item, i) => [i, wire(item)])) } : { kind: 'array' };
    if (typeof value === 'object') return Object.keys(value).length ? { kind: 'object', value: Object.fromEntries(Object.entries(value).map(([name, item]) => [key(name), wire(item)])) } : { kind: 'object' };
    return { kind: 'scalar', value };
}
function epochMicros(time) {
    if (time?.seconds !== undefined) return time.seconds * 1000000 + Math.floor(time.nanoseconds / 1000);
    const date = String(time || new Date().toISOString());
    const fraction = date.match(/\.(\d+)/)?.[1] || '';
    return Math.floor(Date.parse(date) / 1000) * 1000000 + Number(fraction.padEnd(6, '0').slice(0, 6));
}
function node(data, version, sortTime = 0) {
    return data ? { version, data: wire(data), sortTime } : { version, deleted: true };
}
const newer = (current, incoming) => !current || incoming.version >= current.version ? incoming : undefined;
module.exports = { key, wire, epochMicros, node, newer };
