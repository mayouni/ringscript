# The Ring half of the probe: the same two workloads as kernel.zig,
# written the way an application would write them.

aData = []

func BenchLoop n
	s = 0
	for i = 1 to n
		s = s + i * 2 - 1
	next
	return s

func BuildData n
	aData = []
	for i = 1 to n
		aData + (i % 977)
	next
	return len(aData)

# the ledger shape: walk every row, filter, weight, accumulate
func SumWeighted p
	s = 0
	for i = 1 to len(aData)
		v = aData[i]
		if v > 100
			s = s + v * 3
		ok
	next
	return s

# how much of SumWeighted is LIST ACCESS rather than arithmetic:
# same walk, same count, but touching nothing
func WalkOnly p
	s = 0
	for i = 1 to len(aData)
		s = s + 1
	next
	return s

# the plumbing question, measured from inside: hand the whole list to the
# host as one value
func ExportData p
	return JsonEncode(aData)
