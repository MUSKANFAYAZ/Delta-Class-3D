const mongoose=require("mongoose");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({

 name:{
   type:String,
   required:true
 },

 studentClass: {
   type: String,
   default: "",
   trim: true,
 },

 phone:{
   type:String,
   required:true,
   unique:true
 },

 password:{
   type:String,
   required:true
 },

 userId:{
   type:String,
   unique:true
 },

 role:{
   type:String,
   enum:["teacher","student"],
   required:true
 }

});
userSchema.pre("save", function(next){

 if(!this.userId){

   this.userId=
   "USR"+
   Math.floor(
     100000 + Math.random()*900000
   );
 }

 next();

});

userSchema.pre("save", async function (next) {
  try {
    if (!this.isModified("password")) return next();
    const saltRounds = 10;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (e) {
    next(e);
  }
});

module.exports= mongoose.model("User",userSchema);