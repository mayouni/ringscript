person = [
    :name  = "Alice",
    :age   = 30,
    :email = "alice@example.com",
    :address = [
        :city    = "Cairo",
        :country = "Egypt",
        :zip     = "12345"
    ],
    :hobbies = ["chess", "coding", "reading"]
]
? "Name  : " + person[:name]
? "Age   : " + person[:age]
? "Email : " + person[:email]
? "City    : " + person[:address][:city]
? "Country : " + person[:address][:country]
? "Zip     : " + person[:address][:zip]
? "Hobbies:"
for hobby in person[:hobbies]
    ? "  - " + hobby
next
