import { migrateEveronnDatabase } from "./migrate-everonn-database";

migrateEveronnDatabase(true).then(result => console.log(JSON.stringify(result))).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
