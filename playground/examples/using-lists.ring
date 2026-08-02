aList = ["one","two","three"]
aList2 = aList  # Deep Copy

aList[1] = 1    # Index starts from 1  
  
? alist[1]      # print 1
? aList2[1]     # print one

# We can use lists during definition 
myList = [ [:a,:b,:c] , myList[1] , myList[1] ]
see myList      # print a b c a b c a b c
