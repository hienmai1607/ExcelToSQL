"""Database uniqueness is global, including inline and direct API writes."""
import unittest
import pyodbc
import packaging_field_foundation_contract as foundation

class MasterDescriptionUniqueness(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    def setUp(self):foundation.PackagingFoundation.setUp(self)
    def test_customer_description_cannot_be_duplicated(self):
        with self.assertRaises(pyodbc.IntegrityError) as error:
            self.cur.execute("""INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,CreatedBy)
                SELECT UPPER(CustomerName),MarketID,CurrencyID,? FROM dbo.Customer WHERE ID=?""",self.actor,self.customer)
        self.assertIn('UQ_Customer_Name',str(error.exception))
    def test_product_description_is_unique_across_customers(self):
        customer=self.cur.execute("""INSERT dbo.Customer(CustomerName,MarketID,CurrencyID,CreatedBy)
            SELECT 'Uniqueness '+CONVERT(VARCHAR(36),NEWID()),MarketID,CurrencyID,? FROM dbo.Customer WHERE ID=?;
            SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.customer).fetchval()
        with self.assertRaises(pyodbc.IntegrityError) as error:
            self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID)
                SELECT 'U-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),UPPER(ProductName),100,?,?
                FROM dbo.Product WHERE ID=?""",self.actor,customer,self.product)
        self.assertIn('UQ_Product_Name',str(error.exception))
