// Tiny static server for local development: node server.mjs, then open http://localhost:4175
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname( fileURLToPath( import.meta.url ) );
const port = 4175;

const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

createServer( ( request, response ) => {
  const path = decodeURIComponent( new URL( request.url, "http://localhost" ).pathname );
  const file = normalize( join( root, path === "/" ? "index.html" : path ) );
  if ( !file.startsWith( root ) ) {
    response.writeHead( 403 ).end();
    return;
  }
  try {
    if ( !statSync( file ).isFile() ) throw new Error( "not a file" );
  } catch {
    response.writeHead( 404 ).end( "Not found" );
    return;
  }
  response.writeHead( 200, { "Content-Type": types[extname( file )] ?? "application/octet-stream", "Cache-Control": "no-store" } );
  createReadStream( file ).pipe( response );
} ).listen( port, "127.0.0.1", () => console.log( `Pool Pattern Board on http://localhost:${port}` ) );
