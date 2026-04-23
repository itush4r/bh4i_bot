require("dotenv").config({ path: ".env.local" });

async function verify() {
  try {
    const dbConnect = (await import("./src/lib/db.js")).default;
    await dbConnect();
    console.log("MongoDB is connected successfully.");

    const User = (await import("./src/models/User.js")).default;
    
    // Perform a test write and delete to ensure Mongoose creates the collection
    const testId = "test_user_for_collection_" + Date.now();
    const testDoc = new User({ chatId: testId, name: "Test Setup" });
    await testDoc.save();
    console.log("Test user successfully saved! Collection is now visible in Atlas.");
    
    await User.deleteOne({ chatId: testId });
    console.log("Test user successfully deleted.");
    
    process.exit(0);
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

verify();
