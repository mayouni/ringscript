new Sum {
    10
    20  40
    100 2000 
    -20
    201.5
}

class Sum

    nSum = 0

    func braceExprEval nValue
        if ! isNumber(nValue) return ok
        nSum += nValue

    func braceEnd
        ? "Sum: " + nSum
