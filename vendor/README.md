# Vendored WeChat SDK

`wechatbot-zerolink-2.2.0-zerolink.2.tgz` is the Node.js package built from
[`zhangjingwei/wechatbot-zerolink`](https://github.com/zhangjingwei/wechatbot-zerolink)
commit `69503465fca8e22a338523751564e3680e639610` on
`feat/realname-pin-binding`. SHA-256:

`59dbd43aa55b54c2f19684b67ecb61b47ab06b83ece6858db56ffd8a55665b69`

The SDK retains the upstream MIT license and attribution. This checked-in
package lets standard Weixin Link installs use the reviewed SDK without an
npm login or GitHub SSH access. To update it, build and test the SDK at a
pinned commit, run `npm pack` in the fork root, replace the tarball, update
this checksum and `package.json`, and regenerate `package-lock.json`.
