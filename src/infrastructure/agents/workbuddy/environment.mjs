// Only host environment; account credentials remain in the official CLI's home.
export function workbuddyEnvironment(source=process.env){
 const allowed=/^(HOME|USERPROFILE|PATH|Path|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_[A-Z_]+|TZ|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy|CODEBUDDY_CONFIG_DIR)$/
 return {...Object.fromEntries(Object.entries(source).filter(([key])=>allowed.test(key))),DISABLE_AUTOUPDATER:'1',CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS:'1'}
}
