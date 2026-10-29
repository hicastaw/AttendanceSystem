import fs from 'node:fs';

export const mode = process.env.APP_MODE || 'production';
if (!['production', 'mock'].includes(mode)) throw new Error('APP_MODE must be production or mock');
if(process.env.PORT!==undefined && (!/^\d+$/.test(process.env.PORT) || Number(process.env.PORT)>65535))throw new Error('PORT must be 0..65535');
if(process.env.NODE_ENV==='production'){
  for(const name of ['ADMIN_PASSWORD','EDGE_DEVICE_KEY']){
    const value=process.env[name];
    if(typeof value!=='string'||value.length<24||value.startsWith('change-me'))throw new Error(`${name} must be provisioned (24+ characters, not an example)`);
  }
  const ttl=Number(process.env.ADMIN_TOKEN_TTL_SECONDS||3600);
  if(!Number.isFinite(ttl)||ttl<1||ttl>86400)throw new Error('ADMIN_TOKEN_TTL_SECONDS must be finite, 1..86400');
}
const manifest = JSON.parse(fs.readFileSync(new URL('../../embedding-contract.json', import.meta.url), 'utf8'));
export const legacyContract = manifest.legacy;
export const contract = mode === 'mock' ? manifest.mock : manifest.legacy;
export const contractJson = JSON.stringify(contract);
export function normalizeEmbedding(vector) {
  if (!Array.isArray(vector) || vector.length !== 512 || vector.some(x => typeof x !== 'number' || !Number.isFinite(x))) {
    throw new Error('Invalid embedding');
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-8) throw new Error('Invalid embedding norm');
  return vector.map(x => x / norm);
}
export function sameContract(value) {
  return value && Object.keys(value).length === 4 && Object.keys(contract).every(k => value[k] === contract[k]);
}
