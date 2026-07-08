import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

export async function POST(req: NextRequest) {
  try {
    const { apiToken } = await req.json();
    if (!apiToken) {
      return NextResponse.json({ error: 'Missing apiToken' }, { status: 400 });
    }

    // Save to txline-config.json in the workspace root
    const configPath = path.join(process.cwd(), '../../txline-config.json');
    const config = {
      apiToken,
      updatedAt: new Date().toISOString()
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log(`[Setup API] Successfully saved TxLINE API token to ${configPath}`);

    return NextResponse.json({ success: true, path: configPath });
  } catch (err: any) {
    console.error('[Setup API] Error saving token:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
