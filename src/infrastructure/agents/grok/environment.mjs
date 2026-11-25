// Keep official CLI login in its own storage; never inherit API credentials.
export function grokEnvironment(source=process.env){
 const allowed=/^(HOME|USERPROFILE|PATH|Path|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_[A-Z_]+|TZ|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)$/
 return Object.fromEntries(Object.entries(source).filter(([key])=>allowed.test(key)))
}
