import { NextResponse } from 'next/server';
import dbConnect from '../../../lib/db';
import User from '../../../models/User';

export async function GET() {
  try {
    await dbConnect();
    
    const testId = "test_user_for_collection_" + Date.now();
    const testDoc = new User({ chatId: testId, name: "Test Setup" });
    await testDoc.save();
    
    await User.deleteOne({ chatId: testId });
    
    return NextResponse.json({ status: "Collection test write complete!" });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
