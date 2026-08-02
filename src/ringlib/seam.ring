# ---------------------------------------------------------------------------
# The outward seam: Ring asking the page, or the platform, to do something.
#
# Both functions are the same mechanism — jscall(name, json) with Ring values
# encoded on the way out and decoded on the way back. They differ in what they
# are FOR, and the distinction is the one Softanza already makes:
#
#   Page(...)      the document in front of the user. Web-only by nature:
#                  reading a field, setting text, anything about THIS page.
#
#   Platform(...)  the capability envelope of the target the app is deployed
#                  to — storage, notifications, exit. In StzWeb this is
#                  stz.platform: one contract, a different adapter per
#                  target, so app code stays portable across web, desktop
#                  and mobile. Nothing target-specific belongs here.
#
# Using the right one keeps that distinction visible in Ring source: a
# Page(...) call says "this is web", a Platform(...) call says "this works
# wherever the app is deployed".
#
# RingScript.boot() registers settext / gettext / getvalue for Page().
# Everything else is yours: ring.on("name", fn) in JavaScript.
# ---------------------------------------------------------------------------

# Ask the page. Returns the handler's result as a Ring value, NULL if none.
func Page cName, vData
	return rs_seam(cName, vData)

# Ask the platform for a capability — the stz.platform contract in StzWeb.
func Platform cName, vData
	return rs_seam(cName, vData)

func rs_seam cName, vData
	cRes = jscall(cName, JsonEncode(vData))
	if cRes = NULL or len(cRes) = 0
		return NULL
	ok
	return JsonDecode(cRes)
