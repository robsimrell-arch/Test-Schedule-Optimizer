async function main() {
  console.log("Fetching http://localhost:5000/api/schedule...");
  const start = Date.now();
  try {
    const res = await fetch("http://localhost:5000/api/schedule");
    const duration = Date.now() - start;
    console.log(`Success! Status: ${res.status}, Duration: ${duration}ms`);
    if (res.ok) {
      const data = await res.json();
      console.log("Keys of response data:", Object.keys(data));
      if (Array.isArray(data)) {
        console.log(`Data is an array of length ${data.length}`);
      } else {
        console.log("Data is not an array");
      }
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }
}

main();
