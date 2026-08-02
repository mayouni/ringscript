# ===========================================================================
#  RingScript — library file (RingPM)
# ===========================================================================
#  Helpers a Ring developer can use after `ringpm install ringscript`.
#  From inside the package folder:
#
#      load "lib.ring"
#      RingScriptServe()                # serve the Playground, open a browser
#      RingScriptNew("mysite")          # scaffold a Ring-scripted web page
#      ? RingScriptRuntimeFiles()       # the two files you deploy
#
#  Every function takes an optional cHome (the package folder). Pass it when
#  you call from elsewhere; omit it and the current directory is used.
#  There is deliberately no global state: main.ring loads this file at
#  runtime, and eval() assigns in the caller's scope, not the global one.
#
#  All of this runs on your machine with native Ring. What it hands you —
#  ringscript.js + ringscript.wasm — is what runs in the browser.
# ===========================================================================

func RingScriptVersionNumber
	return "0.9"

func RingScriptRingVersion
	return "1.27"

func RingScriptVersion
	return "RingScript " + RingScriptVersionNumber() +
	       " (Ring " + RingScriptRingVersion() + ")"

# --------------------------------------------------------------- the CLI

# Dispatches `ring main.ring <command>`; main.ring calls this with its folder.
func RingScriptCLI cHome
	cHome = RingScriptCleanHome(cHome)
	aArgs = RingScriptArgs()
	cCmd = "serve"
	if len(aArgs) > 0 cCmd = lower(aArgs[1]) ok

	switch cCmd
	on "serve"
		nPort = 8377
		if len(aArgs) > 1 nPort = number(aArgs[2]) ok
		RingScriptServe(cHome, nPort)
	on "new"
		cFolder = "ringscript-site"
		if len(aArgs) > 1 cFolder = aArgs[2] ok
		RingScriptNew(cHome, cFolder)
	on "preview"
		if len(aArgs) < 2
			see "  Usage: ring main.ring preview <folder> [port]" + nl
			return
		ok
		nPort = 8377
		if len(aArgs) > 2 nPort = number(aArgs[3]) ok
		RingScriptPreview(cHome, aArgs[2], nPort)
	on "where"
		see "  Copy these two files next to your HTML:" + nl
		for cFile in RingScriptRuntimeFiles(cHome)
			see "    " + cFile + nl
		next
	on "version"
		see "  " + RingScriptVersion() + nl
	other
		RingScriptUsage()
	off

# Arguments after the script name, whichever way we were started.
func RingScriptArgs
	aOut = []
	bSeen = false
	for cArg in sysargv
		if bSeen
			add(aOut, cArg)
		but substr(lower(cArg), ".ring") > 0
			bSeen = true
		ok
	next
	return aOut

func RingScriptUsage
	see "
  RingScript " + RingScriptVersionNumber() + " — the Ring language, resident in the browser

    ringpm run ringscript              serve the Playground and open it
    ring main.ring serve [port]        serve on a chosen port (default 8377)
    ring main.ring new <folder>        scaffold a Ring-scripted web page
    ring main.ring preview <f> [port]  serve a folder you made, and open it
    ring main.ring where               print the two files you deploy
    ring main.ring version             versions of RingScript and Ring

  Documentation: docs/README.md
"

# --------------------------------------------------------------- locations

# The two files you copy into a web project.
func RingScriptRuntimeFiles cHome
	cBase = RingScriptCleanHome(cHome) + "/playground/"
	return [ cBase + "ringscript.js", cBase + "ringscript.wasm" ]

# The prebuilt server for this machine, or "" when we ship none for it.
# The binaries are tiny (about 40 KB) and static: no toolchain needed.
func RingScriptServerBinary cHome
	cBin = RingScriptCleanHome(cHome) + "/bin/ringscript-serve-"
	cArch = lower(getarch())
	bArm = substr(cArch, "arm") > 0 or substr(cArch, "aarch") > 0
	if iswindows()
		cBin += "windows-x64.exe"
	but ismacosx()
		if bArm cBin += "macos-arm64" else cBin += "macos-x64" ok
	but islinux() or isfreebsd()
		if bArm cBin += "linux-arm64" else cBin += "linux-x64" ok
	else
		return ""
	ok
	if not fexists(cBin) return "" ok
	return cBin

# --------------------------------------------------------------- commands

# Serve the Playground and open it in the default browser.
func RingScriptServe cHome, nPort
	cHome = RingScriptCleanHome(cHome)
	return RingScriptPreview(cHome, cHome + "/playground", nPort)

# Serve any folder (a site you scaffolded, say) and open it.
func RingScriptPreview cHome, cFolder, nPort
	cHome = RingScriptCleanHome(cHome)
	if nPort = NULL or nPort < 1 nPort = 8377 ok
	if cFolder = NULL or cFolder = "" cFolder = cHome + "/playground" ok
	cServer = RingScriptServerBinary(cHome)
	if cServer = ""
		see "  No prebuilt server for this platform (" + getarch() + ")." + nl +
		    "  Build one with Zig:  zig build dist" + nl +
		    "  Or serve " + cFolder + " with any static web server." + nl
		return 0
	ok
	cURL = "http://localhost:" + nPort + "/"
	see "  RingScript " + RingScriptVersionNumber() + " — serving " + cFolder + nl +
	    "  Open " + cURL + " (Ctrl+C to stop)" + nl + nl
	RingScriptOpenBrowser(cURL)
	system(RingScriptQuote(cServer) + " " + nPort + " " + RingScriptQuote(cFolder))
	return 1

# Scaffold a web project: the two runtime files + a page already scripted
# in Ring. Relative folders are created where YOU are, not in the package.
func RingScriptNew cHome, cFolder
	cHome = RingScriptCleanHome(cHome)
	if cFolder = NULL or cFolder = "" cFolder = "ringscript-site" ok
	if direxists(cFolder)
		see "  '" + cFolder + "' already exists — choose another name." + nl
		return 0
	ok
	system(RingScriptMkDir(cFolder))
	for cFile in RingScriptRuntimeFiles(cHome)
		write(cFolder + "/" + RingScriptBaseName(cFile), read(cFile))
	next
	write(cFolder + "/index.html", read(cHome + "/cli/starter.html"))
	see "  Created " + cFolder + "/ with:" + nl +
	    "    index.html         your page, scripted in Ring" + nl +
	    "    ringscript.js      the loader" + nl +
	    "    ringscript.wasm    the Ring VM" + nl + nl +
	    "  See it now:  ring main.ring preview " + cFolder + nl +
	    "  (or serve that folder with any static web server)" + nl
	return 1

# ---------------------------------------------------------------- helpers

# Package folder without a trailing separator; current directory if unset.
func RingScriptCleanHome cHome
	if cHome = NULL or cHome = "" return currentdir() ok
	c = right(cHome, 1)
	if c = "/" or c = "\" return left(cHome, len(cHome) - 1) ok
	return cHome

func RingScriptOpenBrowser cURL
	if iswindows()
		system('start "" "' + cURL + '"')
	but ismacosx()
		system('open "' + cURL + '"')
	else
		system('xdg-open "' + cURL + '" >/dev/null 2>&1 &')
	ok

func RingScriptQuote cPath
	return '"' + cPath + '"'

func RingScriptMkDir cFolder
	if iswindows() return 'mkdir "' + cFolder + '"' ok
	return 'mkdir -p "' + cFolder + '"'

func RingScriptBaseName cPath
	nPos = 0
	for i = len(cPath) to 1 step -1
		c = substr(cPath, i, 1)
		if c = "/" or c = "\" nPos = i exit ok
	next
	if nPos = 0 return cPath ok
	return substr(cPath, nPos + 1)
