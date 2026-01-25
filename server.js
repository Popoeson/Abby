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
  name: { type: String, required: true  },
  category: { type: String, required: true },
  price: { type: String, required: true },
  desc: { type: String},
  image: {type: String,required: true},
  stock: { type: Number,default: 0},
  isOutOfStock: { type: Boolean, default: false }
}, { timestamps: true });

const Product = mongoose.model("Product", productSchema);

// ===== FEEDBACK SCHEMA ======
const feedbackSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  }
}, { timestamps: true });

const Feedback = mongoose.model("Feedback", feedbackSchema);

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
app.post("/products", parser.single("image"), async (req, res) => {
  try {
    const { name, category, price, desc, stock, isOutOfStock } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Image required" });
    }

    const parsedStock = Number(stock) || 0;
    const outStatus =
      isOutOfStock === "true" || parsedStock === 0;

    const newProduct = new Product({
      name,
      category,
      price,
      desc,
      image: req.file.path,
      stock: parsedStock,
      isOutOfStock: outStatus
    });

    await newProduct.save();
    res.json(newProduct);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT edit product
app.put("/products/:id", parser.single("image"), async (req, res) => {
  try {
    const { name, category, price, desc, stock, isOutOfStock } = req.body;

    const parsedStock = Number(stock);
    const updateData = {
      name,
      category,
      price,
      desc
    };

    if (!isNaN(parsedStock)) {
      updateData.stock = parsedStock;
      updateData.isOutOfStock =
        isOutOfStock === "true" || parsedStock === 0;
    }

    if (req.file) {
      updateData.image = req.file.path;
    }

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );

    res.json(updated);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
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

// ===== SAVE FEEDBACK ======
app.post("/api/feedbacks", async (req, res) => {
  try {
    const { name, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ error: "All fields required" });
    }

    const feedback = new Feedback({ name, message });
    await feedback.save();

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ====== FETCH FEEDBACK ========
app.get("/api/feedbacks", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;

    const feedbacks = await Feedback
      .find()
      .sort({ createdAt: -1 }) // newest first
      .limit(limit);

    res.json(feedbacks);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ----------------------------
// PAYSTACK PAYMENT ROUTES
// ----------------------------

// Initiate payment
app.post("/api/payment/initiate", async (req, res) => {
  const { name, address, phone, bus, email, mode, cartItems, amount } = req.body;

  if (!name || !address || !phone || !email || !cartItems || !amount) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const reference = "abwy_" + Date.now();

  const paystackPayload = {
    email, // ✅ CUSTOMER EMAIL (Paystack sends receipt here)
    amount: amount * 100,
    currency: "NGN",
    reference,
    metadata: {
      customer_name: name,
      phone,
      address,
      bus,
      mode,
      cartItems
    }
  };

  try {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(paystackPayload)
    });

    const data = await response.json();

    if (!data.status) {
      return res.status(400).json({ error: "Paystack initialization failed" });
    }

    res.json({
      reference,
      publicKey: process.env.PAYSTACK_PUBLIC_KEY
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error during payment initiation" });
  }
});

// Verify payment
app.post("/api/payment/verify", async (req,res)=>{
  const { reference } = req.body;
  if(!reference) return res.status(400).json({ error:"Reference required" });

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    });
    const data = await response.json();
    if(data.status && data.data.status === "success"){
      // Payment successful, save order in DB if needed
      return res.json({ status: "success", message: "Payment verified" });
    }
    return res.json({ status: "failed", message: "Payment verification failed" });
  } catch(err){
    console.error(err);
    res.status(500).json({ error: "Server error during verification" });
  }
});

// ----------------------------
// START SERVER
// ----------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));