# ===========================================================================
#  RingScript — the command run by `ringpm run ringscript`
# ===========================================================================
#      ringpm run ringscript              serve the Playground, open a browser
#      ring main.ring serve [port]        same, on a port you choose
#      ring main.ring new <folder>        scaffold a Ring-scripted web page
#      ring main.ring preview <f> [port]  serve a folder you made, and open it
#      ring main.ring where               print the two files you deploy
#      ring main.ring version             versions of RingScript and Ring
#
#  This file is deliberately self-locating: it finds its own folder and
#  loads lib.ring from there at runtime, so it works whether RingPM ran it
#  from the package folder or you called it by absolute path from your own
#  project directory (where `new` will then scaffold).
# ===========================================================================

func main
	cHome = RingScriptHome()
	# Runtime load (not the compile-time `load`), so the path can be computed.
	# Ring string literals have no escape sequences, so Windows backslashes
	# in the path need no special handling.
	eval('load "' + cHome + 'lib.ring"')
	RingScriptCLI(cHome)

# The folder holding this script, with its trailing separator.
func RingScriptHome
	cFile = filename()
	for i = len(cFile) to 1 step -1
		c = substr(cFile, i, 1)
		if c = "/" or c = "\"
			return left(cFile, i)
		ok
	next
	return ""
