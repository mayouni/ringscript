# Name folding in the string-name lookups. Stock Ring 1.27, no extensions.
#
#   ring tests/upstream/namefold.ring
#
# The compiler folds identifiers to lower case when it stores them; these
# four functions take a name as a string and compare it exactly. Each is
# called twice with the same variable, spelled two ways.

func Main
    ? "1. varptr"
    nTotal = 7
    try
        x = varptr("ntotal","int")
        ? "   lower 'ntotal' -> ok"
    catch
        ? "   lower 'ntotal' -> ERROR"
    done
    try
        x = varptr("nTotal","int")
        ? "   cased 'nTotal' -> ok"
    catch
        ? "   cased 'nTotal' -> R6 Variable is required"
    done

    ? ""
    ? "2. ring_state_findvar"
    st = ring_state_init()
    ring_state_runcode(st, "nCount = 42")
    Show("   lower 'ncount'", ring_state_findvar(st, "ncount"))
    Show("   cased 'nCount'", ring_state_findvar(st, "nCount"))

    ? ""
    ? "3. ring_state_setvar"
    ring_state_setvar(st, "ncount", 99)
    ring_state_runcode(st, "? '   lower -> ' + nCount")
    try
        ring_state_setvar(st, "nCount", 123)
        ? "   cased -> ok"
    catch
        ? "   cased -> R6 Variable is required"
    done

    ? ""
    ? "4. ring_state_newvar — stores the name unfolded"
    st2 = ring_state_init()
    ring_state_newvar(st2, "cRegion")
    Show("   findvar 'cRegion'", ring_state_findvar(st2, "cRegion"))
    Show("   findvar 'cregion'", ring_state_findvar(st2, "cregion"))
    ? "   ...so Ring code in that state, which folds, cannot reach it:"
    ring_state_runcode(st2, "? '   [' + cRegion + ']'")

func Show cLabel, p
    if isnumber(p) and p = 0
        ? cLabel + " -> NOT FOUND"
    else
        ? cLabel + " -> found"
    ok
