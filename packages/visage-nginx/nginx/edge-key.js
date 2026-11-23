import fs from 'fs';

export default function value() {
  let key = ngx.shared.edge_key.get('edge_key');
  if (key === undefined) {
    key = fs.readFileSync('/run/secrets/VISAGE_EDGE_KEY', 'utf8').trim();
    ngx.shared.edge_key.set('edge_key', key);
  }
  return key;
}
