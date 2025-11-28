require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const app = express();

// ----------------------------
// CONFIGURATION
// ----------------------------
app.use(cors());
app.use(express.json());

// ----------------------------
// CLOUDINARY SETUP
// ----------------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "abby-wears",
    allowed_formats: ["jpg","png","jpeg"],
  },
});

const parser = multer({ storage });

// ----------------------------
// MONGODB & PRODUCT SCHEMA
// ----------------------------
mongoose.connect(process.env.MONGO_URI, {useNewUrlParser:true, useUnifiedTopology:true})
.then(()=>console.log("MongoDB connected"))
.catch(err=>console.log("MongoDB error:", err));

const productSchema = new mongoose.Schema({
  name: {type:String, required:true},
  category: {type:String, required:true},
  price: {type:String, required:true},
  desc: {type:String},
  image: {type:String, required:true}
}, {timestamps:true});

const Product = mongoose.model("Product", productSchema);

// ----------------------------
// ROUTES
// ----------------------------

// GET all products
app.get("/products", async (req,res)=>{
  try{
    const products = await Product.find().sort({createdAt:-1});
    res.json(products);
  }catch(err){
    res.status(500).json({error:"Server error"});
  }
});

// POST add product
app.post("/products", parser.single("image"), async (req,res)=>{
  try{
    const {name, category, price, desc} = req.body;
    if(!req.file) return res.status(400).json({error:"Image required"});

    const newProduct = new Product({
      name, category, price, desc,
      image: req.file.path
    });

    await newProduct.save();
    res.json(newProduct);
  }catch(err){
    console.log(err);
    res.status(500).json({error:"Server error"});
  }
});

// PUT edit product
app.put("/products/:id", parser.single("image"), async (req,res)=>{
  try{
    const {name, category, price, desc} = req.body;
    const updateData = {name, category, price, desc};
    if(req.file) updateData.image = req.file.path;

    const updated = await Product.findByIdAndUpdate(req.params.id, updateData, {new:true});
    res.json(updated);
  }catch(err){
    console.log(err);
    res.status(500).json({error:"Server error"});
  }
});

// DELETE product
app.delete("/products/:id", async (req,res)=>{
  try{
    await Product.findByIdAndDelete(req.params.id);
    res.json({message:"Product deleted"});
  }catch(err){
    console.log(err);
    res.status(500).json({error:"Server error"});
  }
});

// ----------------------------
// START SERVER
// ----------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));