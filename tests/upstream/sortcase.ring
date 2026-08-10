# One measurement per process, so nothing carries over between sizes.
#   ring sortcase.ring flat 20000
#   ring sortcase.ring rows 20000

func Main
	aArg = sysargv
	cMode = aArg[3]
	n = number(aArg[4])

	aList = []
	if cMode = "rows"
		for i = 1 to n
			aList + [ (i * 7919) % n, i ]
		next
	else
		for i = 1 to n
			aList + ((i * 7919) % n)
		next
	ok

	t1 = clock()
	if cMode = "rows"
		aOut = sort(aList, 1)
	else
		aOut = sort(aList)
	ok
	t2 = clock()

	nMs = (t2 - t1) / clockspersecond() * 1000
	see "" + cMode + " " + n + " " + nMs + nl
