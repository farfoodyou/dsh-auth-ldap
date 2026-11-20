import { Client } from 'ldapts'
import { readFileSync } from 'node:fs'
const ca = readFileSync('/etc/pki/ca-trust/source/anchors/homelab-ldap-ca.crt')
const DN = process.env.BIND_DN, PW = process.env.BIND_PW
async function tryMode(name, fn) {
  try { await fn(); console.log(name, 'OK') } catch (e) { console.log(name, 'FAIL:', e.message) }
}
await tryMode('ldaps://636 (CA)', async () => {
  const c = new Client({ url: 'ldaps://192.168.8.119:636', tlsOptions: { ca: [ca] }, timeout: 5000 })
  await c.bind(DN, PW); await c.unbind()
})
await tryMode('startTLS 389 (CA)', async () => {
  const c = new Client({ url: 'ldap://192.168.8.119:389', timeout: 5000 })
  await c.bind(DN, PW)   // ldapts 会在 startTLS 后重连？
  await c.unbind()
})
await tryMode('startTLS 389 explicit', async () => {
  const c = new Client({ url: 'ldap://192.168.8.119:389', timeout: 5000 })
  await c.startTLS({ ca: [ca] })
  await c.bind(DN, PW); await c.unbind()
})
