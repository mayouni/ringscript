# Reads a list n times — once in order, once through a permutation.
# No sort, no function call, no copy: only the list accessor.
#   ring access.ring seq 20000
#   ring access.ring perm 20000

func Main
	aArg = sysargv
	cMode = aArg[3]
	n = number(aArg[4])

	aList = []
	for i = 1 to n
		aList + i
	next

	nSum = 0
	t1 = clock()
	if cMode = "perm"
		for i = 1 to n
			nSum += aList[ ((i * 7919) % n) + 1 ]
		next
	else
		for i = 1 to n
			nSum += aList[i]
		next
	ok
	t2 = clock()

	see "" + cMode + " " + n + " " + ((t2 - t1) / clockspersecond() * 1000) + " sum=" + nSum + nl
