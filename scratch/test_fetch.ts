async function test() {
  const start = Date.now();
  console.log("Fetching /api/schedule...");
  try {
    const res = await fetch("http://localhost:5000/api/schedule");
    const json = await res.json();
    const duration = Date.now() - start;
    console.log(`Fetched successfully in ${duration}ms!`);
    console.log(`Number of tasks: ${json.tasks?.length}`);
  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

test();
