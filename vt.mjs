import { createCredentialChain } from './lib/authenticate.js'
import { connectDirectory } from './lib/ldap/client.js'

const url = 'ldap://192.168.8.119:389'
const config = {
  local: { enabled: false, usersFile: '/tmp/none.json' },
  ldap: {
    enabled: true, url,
    userSearchBase: 'ou=Users,dc=huyalv,dc=cn',
    userSearchFilter: '(cn={{username}})',
    bindDn: 'cn=gitlab,dc=huyalv,dc=cn',
    bindPasswordEnv: 'DSH_LDAP_BIND_PASSWORD',
    displayNameAttribute: 'cn',
    groupSearchBase: 'ou=Groups,dc=huyalv,dc=cn',
    groupSearchFilter: '(uniqueMember={{dn}})',
    groupNameAttribute: 'cn',
    adminGroups: ['ldap-users'],
    startTls: true, rejectUnauthorized: true, timeoutMs: 5000,
  },
}
const verify = createCredentialChain({
  config,
  readUsers: async () => ({ version: 1, accounts: [] }),
  connector: connectDirectory,
  warn: (m) => console.log('WARN:', m),
})
console.log('binding pw env set?', !!process.env.DSH_LDAP_BIND_PASSWORD)
try {
  console.log('result:', await verify('learner', process.argv[2]))
} catch (e) {
  console.log('THROW:', e?.message)
}
